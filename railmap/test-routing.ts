import axios from 'axios';
import Graph from 'graphology';
import { connectedComponents } from 'graphology-components';
import { dijkstra } from 'graphology-shortest-path';

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function run() {
  console.log("Fetching NYC data...");
  const query = `
    [out:json][timeout:90];
    (
      node["railway"="station"](40.47,-74.26,40.92,-73.70);
      way["railway"](40.47,-74.26,40.92,-73.70);
    );
    out body;
    >;
    out skel qt;
  `;
  const response = await axios.post("https://overpass.kumi.systems/api/interpreter", `data=${encodeURIComponent(query)}`, {
     headers: { "User-Agent": "RailmapApp/1.0" }
  });
  
  const elements = response.data.elements;
  const nodes = new Map();
  const ways = [];
  const stations = [];

  for (const el of elements) {
    if (el.type === "node") {
      const isStation = el.tags?.railway === "station";
      nodes.set(el.id, { id: el.id, lat: el.lat, lon: el.lon, name: el.tags?.name || "Unknown Station", isStation });
      if (isStation) stations.push(el.id);
    } else if (el.type === "way") {
      ways.push(el);
    }
  }

  const graph = new Graph();
  const wayNodesSet = new Set();
  
  for (const way of ways) {
    if (!way.nodes || way.nodes.length < 2) continue;
    for (let i = 0; i < way.nodes.length - 1; i++) {
       const n1Id = way.nodes[i];
       const n2Id = way.nodes[i+1];
       const n1 = nodes.get(n1Id);
       const n2 = nodes.get(n2Id);
       if (n1 && n2) {
          wayNodesSet.add(n1Id); wayNodesSet.add(n2Id);
          if (!graph.hasNode(n1Id)) graph.addNode(n1Id, n1);
          if (!graph.hasNode(n2Id)) graph.addNode(n2Id, n2);
          if (!graph.hasEdge(n1Id, n2Id)) {
             graph.addUndirectedEdge(n1Id, n2Id, { weight: getDistance(n1.lat, n1.lon, n2.lat, n2.lon) });
          }
       }
    }
  }

  let snapped = 0;
  for (const stId of stations) {
     const stNode = nodes.get(stId);
     if (!graph.hasNode(stId)) {
        graph.addNode(stId, stNode);
     }
     
     // Snap to nearest track node
     let minDist = Infinity;
     let nearest = null;
     for (const wNId of wayNodesSet) {
        if (wNId === stId) continue;
        const wNode = nodes.get(wNId);
        const dist = getDistance(stNode.lat, stNode.lon, wNode.lat, wNode.lon);
        if (dist < minDist) { minDist = dist; nearest = wNId; }
     }
     if (nearest && minDist < 0.2) { // within 200m
        if (!graph.hasEdge(stId, nearest)) {
           graph.addUndirectedEdge(stId, nearest, { weight: minDist });
           snapped++;
        }
     }
  }
  console.log(`Snapped ${snapped} stations to tracks.`);

  // Connect nearby stations (walking transfers)
  let transfers = 0;
  for (let i=0; i<stations.length; i++) {
     for (let j=i+1; j<stations.length; j++) {
        const s1 = nodes.get(stations[i]);
        const s2 = nodes.get(stations[j]);
        const dist = getDistance(s1.lat, s1.lon, s2.lat, s2.lon);
        if (dist < 0.4) {
           if (!graph.hasEdge(s1.id, s2.id)) {
              graph.addUndirectedEdge(s1.id, s2.id, { weight: dist * 3 });
              transfers++;
           }
        }
     }
  }
  console.log(`Added ${transfers} transfer edges.`);
  
  const components = connectedComponents(graph);
  console.log(`Graph has ${components.length} connected components.`);
  console.log(`Largest component has ${Math.max(...components.map(c => c.length))} nodes out of ${graph.order} total.`);
}

run().catch(console.error);
