import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import Graph from "graphology";
import { dijkstra } from "graphology-shortest-path";
import fs from "fs";

// --- Haversine distance (km) ---
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Types ---
interface LineInfo {
  ref: string;
  name: string;
  color: string;
  routeType: string;
  operator: string;
}

interface InstructionLeg {
  lineRef: string;
  lineName: string;
  lineColor: string;
  routeType: string;
  boardStation: string;
  alightStation: string;
  stops: number;
  intermediateStations: string[];
  estimatedMinutes: number;
  pathStartIdx: number;
  pathEndIdx: number;
}

interface RouteInstructions {
  legs: InstructionLeg[];
  totalStops: number;
  transfers: number;
  estimatedMinutes: number;
}

// --- Caching ---
const cache: {
  data: any;
  graph: Graph | null;
  lineInfoMap: Map<string, LineInfo>;
  stationToLines: Map<number, string[]>;
  error: string | null;
  errorTime: number;
} = { data: null, graph: null, lineInfoMap: new Map(), stationToLines: new Map(), error: null, errorTime: 0 };

const NEGATIVE_CACHE_TTL = 30_000;
const SNAP_RADIUS_KM = 0.5;
const WALKING_TRANSFER_KM = 0.8;
const WALKING_PENALTY = 3;

const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const OVERPASS_QUERY = `[out:json][timeout:120];(node["railway"="station"](40.477,-74.259,40.917,-73.700);way["railway"](40.477,-74.259,40.917,-73.700););out body;>;out skel qt;relation["type"="route"]["route"~"subway|train|light_rail|tram"](40.477,-74.259,40.917,-73.700);out body;`;

// --- Load raw data (local → Overpass fallback) ---
async function fetchRawData(): Promise<any> {
  const cachePath = path.join(process.cwd(), "nyc-data.json");
  if (fs.existsSync(cachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      if (data.elements?.length > 0) {
        console.log(`Loaded ${data.elements.length} elements from local cache.`);
        return data;
      }
    } catch (err: any) {
      console.warn(`Local cache corrupt: ${err.message}. Trying Overpass...`);
    }
  }
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Fetching from ${ep}...`);
      const res = await axios.post(ep, `data=${encodeURIComponent(OVERPASS_QUERY)}`, {
        headers: { "User-Agent": "RailmapApp/1.0" },
        timeout: 180_000,
      });
      if (res.data.elements?.length > 0) {
        fs.writeFileSync(cachePath, JSON.stringify(res.data), "utf-8");
        console.log(`Fetched ${res.data.elements.length} elements and cached.`);
        return res.data;
      }
    } catch (err: any) {
      console.warn(`${ep} failed: ${err.message}`);
    }
  }
  throw new Error("Failed to load data from all sources.");
}

// --- Build graph with line info ---
function buildGraph(data: any) {
  const elements = data.elements;
  const nodes = new Map<number, any>();
  const ways: any[] = [];
  const stations: number[] = [];
  const relations: any[] = [];

  for (const el of elements) {
    if (el.type === "node") {
      const isStation = el.tags?.railway === "station";
      nodes.set(el.id, {
        id: el.id, lat: el.lat, lon: el.lon,
        name: el.tags?.name || "Unknown Station",
        isStation,
      });
      if (isStation) stations.push(el.id);
    } else if (el.type === "way") {
      ways.push(el);
    } else if (el.type === "relation") {
      relations.push(el);
    }
  }

  // Parse transit line relations
  const lineInfoMap = new Map<string, LineInfo>();
  const wayToLines = new Map<number, string[]>();
  const stationToLines = new Map<number, string[]>();

  for (const rel of relations) {
    const t = rel.tags || {};
    if (t.type !== "route") continue;
    const ref = t.ref || t.name || `Route-${rel.id}`;
    const lineKey = `${ref}__${rel.id}`; // unique per relation (same ref can have multiple directions)
    const displayRef = t.ref || t.name?.split(":")[0]?.replace("NYCS - ", "").trim() || ref;

    lineInfoMap.set(lineKey, {
      ref: displayRef,
      name: t.name || displayRef,
      color: t.colour || t.color || "#6366f1",
      routeType: t.route || "train",
      operator: t.operator || "",
    });

    for (const m of rel.members || []) {
      if (m.type === "way") {
        const arr = wayToLines.get(m.ref) || [];
        if (!arr.includes(lineKey)) arr.push(lineKey);
        wayToLines.set(m.ref, arr);
      } else if (m.type === "node" && (m.role === "stop" || m.role === "stop_entry_only" || m.role === "stop_exit_only" || m.role === "")) {
        const arr = stationToLines.get(m.ref) || [];
        if (!arr.includes(lineKey)) arr.push(lineKey);
        stationToLines.set(m.ref, arr);
      }
    }
  }

  console.log(`Parsed ${lineInfoMap.size} transit lines from ${relations.length} relations.`);

  // Build graph
  const graph = new Graph();
  const wayNodesSet = new Set<number>();

  for (const way of ways) {
    if (!way.nodes || way.nodes.length < 2) continue;
    const edgeLines = wayToLines.get(way.id) || [];
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const n1 = nodes.get(way.nodes[i]);
      const n2 = nodes.get(way.nodes[i + 1]);
      if (!n1 || !n2) continue;
      const k1 = String(n1.id), k2 = String(n2.id);
      wayNodesSet.add(n1.id);
      wayNodesSet.add(n2.id);
      if (!graph.hasNode(k1)) graph.addNode(k1, n1);
      if (!graph.hasNode(k2)) graph.addNode(k2, n2);
      if (!graph.hasUndirectedEdge(k1, k2)) {
        const dist = getDistance(n1.lat, n1.lon, n2.lat, n2.lon);
        graph.addUndirectedEdge(k1, k2, { weight: dist, actualDist: dist, type: "track", lines: [...edgeLines] });
      } else {
        // Merge line info into existing edge
        const edge = graph.edge(k1, k2);
        if (edge) {
          const existing: string[] = graph.getEdgeAttribute(edge, "lines") || [];
          for (const l of edgeLines) {
            if (!existing.includes(l)) existing.push(l);
          }
          graph.setEdgeAttribute(edge, "lines", existing);
        }
      }
    }
  }

  // Snap stations to nearest track node
  for (const stId of stations) {
    const st = nodes.get(stId);
    const k = String(stId);
    if (!graph.hasNode(k)) graph.addNode(k, st);
    let minDist = Infinity, nearest: number | null = null;
    for (const wId of wayNodesSet) {
      if (wId === stId) continue;
      const w = nodes.get(wId);
      if (!w) continue;
      const d = getDistance(st.lat, st.lon, w.lat, w.lon);
      if (d < minDist) { minDist = d; nearest = wId; }
    }
    if (nearest && minDist < SNAP_RADIUS_KM) {
      const nk = String(nearest);
      if (!graph.hasUndirectedEdge(k, nk)) {
        graph.addUndirectedEdge(k, nk, { weight: minDist * WALKING_PENALTY, actualDist: minDist, type: "snap", lines: [] });
      }
    }
  }

  // Walking transfers between nearby stations
  for (let i = 0; i < stations.length; i++) {
    for (let j = i + 1; j < stations.length; j++) {
      const s1 = nodes.get(stations[i]), s2 = nodes.get(stations[j]);
      if (!s1 || !s2) continue;
      const d = getDistance(s1.lat, s1.lon, s2.lat, s2.lon);
      if (d < WALKING_TRANSFER_KM) {
        const k1 = String(s1.id), k2 = String(s2.id);
        if (!graph.hasUndirectedEdge(k1, k2)) {
          graph.addUndirectedEdge(k1, k2, { weight: d * WALKING_PENALTY, actualDist: d, type: "walking", lines: [] });
        }
      }
    }
  }

  // Attach line info to station objects for frontend
  const stationsObj = stations.map((id) => {
    const n = nodes.get(id);
    const lineKeys = stationToLines.get(id) || [];
    const lineRefs = [...new Set(lineKeys.map(k => lineInfoMap.get(k)?.ref || "").filter(Boolean))];
    const lineColors = [...new Set(lineKeys.map(k => lineInfoMap.get(k)?.color || "").filter(Boolean))];
    return { ...n, lineRefs, lineColors };
  }).filter(Boolean);

  return { graph, stations: stationsObj, lineInfoMap, stationToLines, stats: { totalNodes: graph.order, totalEdges: graph.size, totalLines: lineInfoMap.size } };
}

// --- Generate deterministic route instructions ---
function generateInstructions(pathNodeIds: string[], graph: Graph, lineInfoMap: Map<string, LineInfo>, stationToLines: Map<number, string[]>): RouteInstructions {
  // Collect path station indices
  const stationIndices: number[] = [];
  for (let i = 0; i < pathNodeIds.length; i++) {
    const attrs = graph.getNodeAttributes(pathNodeIds[i]);
    if (attrs.isStation && attrs.name !== "Unknown Station") {
      stationIndices.push(i);
    }
  }

  if (stationIndices.length < 2) {
    return { legs: [], totalStops: 0, transfers: 0, estimatedMinutes: 0 };
  }

  // For each consecutive station pair, determine the dominant line
  interface StationSegment {
    stationIdx: number;
    stationName: string;
    lineToNext: string | null; // line key used to reach next station
  }

  const segments: StationSegment[] = [];
  for (let s = 0; s < stationIndices.length; s++) {
    const idx = stationIndices[s];
    const name = graph.getNodeAttributes(pathNodeIds[idx]).name;
    let lineToNext: string | null = null;

    if (s < stationIndices.length - 1) {
      const nextIdx = stationIndices[s + 1];
      // Count line occurrences on edges between these two stations
      const lineCounts = new Map<string, number>();
      for (let e = idx; e < nextIdx; e++) {
        const edge = graph.edge(pathNodeIds[e], pathNodeIds[e + 1]);
        if (!edge) continue;
        const lines: string[] = graph.getEdgeAttribute(edge, "lines") || [];
        for (const l of lines) lineCounts.set(l, (lineCounts.get(l) || 0) + 1);
      }

      // Fallback: if no edge-level line data, use station-level intersection
      if (lineCounts.size === 0) {
        const stId1 = Number(pathNodeIds[idx]);
        const stId2 = Number(pathNodeIds[nextIdx]);
        const lines1 = stationToLines.get(stId1) || [];
        const lines2 = stationToLines.get(stId2) || [];
        const common = lines1.filter(l => lines2.includes(l));
        if (common.length > 0) {
          for (const l of common) lineCounts.set(l, 1);
        } else {
          // Use any line from either station
          for (const l of [...lines1, ...lines2]) lineCounts.set(l, 1);
        }
      }

      // Pick line with highest count (prefer previous line for continuity)
      let bestLine: string | null = null;
      let bestCount = 0;
      for (const [l, c] of lineCounts) {
        if (c > bestCount) { bestCount = c; bestLine = l; }
      }

      // Prefer continuing the same line as previous segment
      if (s > 0 && segments[s - 1].lineToNext) {
        const prevLine = segments[s - 1].lineToNext!;
        if (lineCounts.has(prevLine) && lineCounts.get(prevLine)! >= bestCount * 0.5) {
          bestLine = prevLine;
        }
      }

      lineToNext = bestLine;
    }

    segments.push({ stationIdx: idx, stationName: name, lineToNext });
  }

  // Group into legs (consecutive segments on same line)
  const legs: InstructionLeg[] = [];
  let legStart = 0;

  for (let s = 1; s < segments.length; s++) {
    const prevLine = segments[s - 1].lineToNext;
    const currLine = s < segments.length - 1 ? segments[s].lineToNext : null;

    // End of a leg: line changes or we're at the last station
    const isLastStation = s === segments.length - 1;
    const lineChanges = currLine !== null && prevLine !== null && currLine !== prevLine;

    if (isLastStation || lineChanges) {
      const line = segments[legStart].lineToNext;
      const info = line ? lineInfoMap.get(line) : null;
      const stops = s - legStart;
      const intermediate: string[] = [];
      for (let k = legStart + 1; k < s; k++) intermediate.push(segments[k].stationName);

      const minPerStop = info?.routeType === "subway" ? 2.5 : info?.routeType === "light_rail" ? 3 : 4;

      legs.push({
        lineRef: info?.ref || "Railway",
        lineName: info?.name || "Railway",
        lineColor: info?.color || "#6366f1",
        routeType: info?.routeType || "train",
        boardStation: segments[legStart].stationName,
        alightStation: segments[s].stationName,
        stops,
        intermediateStations: intermediate,
        estimatedMinutes: Math.round(stops * minPerStop),
        pathStartIdx: stationIndices[legStart],
        pathEndIdx: stationIndices[s],
      });

      legStart = s;
    }
  }

  // Filter out self-loop / degenerate legs
  const validLegs = legs.filter(l => l.stops > 0 && l.boardStation !== l.alightStation);

  const transferTime = Math.max(0, validLegs.length - 1) * 5;
  const rideTime = validLegs.reduce((sum, l) => sum + l.estimatedMinutes, 0);

  return {
    legs: validLegs,
    totalStops: validLegs.reduce((sum, l) => sum + l.stops, 0),
    transfers: Math.max(0, validLegs.length - 1),
    estimatedMinutes: rideTime + transferTime,
  };
}

// --- Load network ---
async function loadNetwork() {
  if (cache.data && cache.graph) return;
  if (cache.error && Date.now() - cache.errorTime < NEGATIVE_CACHE_TTL) throw new Error(cache.error);
  try {
    const raw = await fetchRawData();
    const result = buildGraph(raw);
    cache.data = { stations: result.stations, stats: result.stats };
    cache.graph = result.graph;
    cache.lineInfoMap = result.lineInfoMap;
    cache.stationToLines = result.stationToLines;
    cache.error = null;
    console.log(`Network ready: ${result.stats.totalNodes} nodes, ${result.stats.totalEdges} edges, ${result.stations.length} stations, ${result.stats.totalLines} lines.`);
  } catch (err: any) {
    cache.error = err.message;
    cache.errorTime = Date.now();
    throw err;
  }
}

// --- Server ---
async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());

  // Security headers
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", networkLoaded: !!cache.data });
  });

  app.get("/api/stations", async (req, res) => {
    try {
      await loadNetwork();
      res.json(cache.data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/route", async (req, res) => {
    const origin = req.query.origin as string;
    const dest = req.query.destination as string;
    if (!origin || !dest) return res.status(400).json({ error: "Both origin and destination are required." });
    if (!cache.graph) return res.status(400).json({ error: "Network not loaded." });

    const graph = cache.graph;
    if (!graph.hasNode(origin)) return res.status(400).json({ error: `Origin '${origin}' not found.` });
    if (!graph.hasNode(dest)) return res.status(400).json({ error: `Destination '${dest}' not found.` });

    try {
      const routePath = dijkstra.bidirectional(graph, origin, dest, "weight");
      if (routePath && routePath.length > 0) {
        let actualDist = 0, weightedDist = 0;
        for (let i = 0; i < routePath.length - 1; i++) {
          const edge = graph.edge(routePath[i], routePath[i + 1]);
          if (edge) {
            weightedDist += graph.getEdgeAttribute(edge, "weight");
            actualDist += graph.getEdgeAttribute(edge, "actualDist");
          }
        }
        const pathNodes = routePath.map((id) => graph.getNodeAttributes(id));
        const instructions = generateInstructions(routePath, graph, cache.lineInfoMap, cache.stationToLines);

        return res.json({ actualDistance: actualDist, weightedDistance: weightedDist, path: pathNodes, instructions });
      }
      return res.json({ actualDistance: null, weightedDistance: null, path: [], instructions: null });
    } catch (e: any) {
      console.error("Routing error:", e.message);
      return res.json({ actualDistance: null, weightedDistance: null, path: [], instructions: null });
    }
  });

  // Vite dev middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== "true" },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`Railmap Server running on http://localhost:${PORT}`));
}

startServer();
