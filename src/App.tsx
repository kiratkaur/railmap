import React, { useState, useEffect, useMemo, useCallback, useRef, Component, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Train, Navigation, Compass, AlertCircle, MoveRight, Search as SearchIcon, X, Menu, RotateCcw, ArrowRight, Footprints, Clock, MapPin } from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, Polyline, useMap, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// --- Types ---
interface NodeInfo { id: number; lat: number; lon: number; name?: string; isStation: boolean; lineRefs?: string[]; lineColors?: string[]; }
interface NetworkData { stations: NodeInfo[]; stats: { totalNodes: number; totalEdges: number; totalLines: number }; }
interface InstructionLeg { lineRef: string; lineName: string; lineColor: string; routeType: string; boardStation: string; alightStation: string; stops: number; intermediateStations: string[]; estimatedMinutes: number; pathStartIdx: number; pathEndIdx: number; }
interface RouteInstructions { legs: InstructionLeg[]; totalStops: number; transfers: number; estimatedMinutes: number; }
interface RouteResult { path: NodeInfo[]; actualDistance: number | null; weightedDistance: number | null; instructions: RouteInstructions | null; }

// --- Error Boundary ---
interface EBProps { children: ReactNode }
interface EBState { hasError: boolean; error: string }
class ErrorBoundary extends Component<EBProps, EBState> {
  declare props: EBProps;
  state: EBState = { hasError: false, error: '' };
  static getDerivedStateFromError(error: Error): EBState { return { hasError: true, error: error.message }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
          <div className="glass-card rounded-2xl p-8 max-w-md text-center">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
            <p className="text-sm text-slate-400 mb-6">{this.state.error}</p>
            <button onClick={() => window.location.reload()} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold text-sm hover:bg-indigo-500 transition-colors">Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Map helpers ---
function MapBounds({ nodes }: { nodes: NodeInfo[] }) {
  const map = useMap();
  useEffect(() => {
    if (nodes.length > 0) {
      const lats = nodes.map(n => n.lat), lons = nodes.map(n => n.lon);
      map.fitBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { padding: [50, 50] });
    }
  }, [nodes, map]);
  return null;
}

function RouteBounds({ path }: { path: NodeInfo[] }) {
  const map = useMap();
  useEffect(() => {
    if (path.length > 1) {
      const lats = path.map(n => n.lat), lons = path.map(n => n.lon);
      map.fitBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { padding: [80, 80], maxZoom: 14 });
    }
  }, [path, map]);
  return null;
}

// --- Route Instructions Component ---
function RouteDirections({ instructions }: { instructions: RouteInstructions }) {
  if (!instructions.legs.length) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-0">
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-800/60 rounded-t-xl border border-slate-700/30 border-b-0">
        <Clock className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          {instructions.totalStops} stops · {instructions.transfers} transfer{instructions.transfers !== 1 ? 's' : ''} · ~{instructions.estimatedMinutes} min
        </span>
      </div>

      <div className="bg-slate-800/40 rounded-b-xl border border-slate-700/30 overflow-hidden">
        {instructions.legs.map((leg, i) => (
          <div key={i}>
            {/* Transfer indicator */}
            {i > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/5 border-y border-amber-500/10">
                <Footprints className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] font-semibold text-amber-400/80">Transfer at {leg.boardStation} · ~5 min</span>
              </div>
            )}

            {/* Leg */}
            <div className="px-4 py-3">
              {/* Line badge + board */}
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 pt-0.5">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-black text-white shadow-lg" style={{ backgroundColor: leg.lineColor }}>
                    {leg.lineRef.length <= 3 ? leg.lineRef : <Train className="w-3 h-3" />}
                  </div>
                  {/* Vertical line */}
                  <div className="w-0.5 flex-1 min-h-[24px] rounded-full" style={{ backgroundColor: leg.lineColor, opacity: 0.4 }} />
                  <div className="w-2 h-2 rounded-full border-2" style={{ borderColor: leg.lineColor }} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Board</div>
                  <div className="text-xs font-bold text-slate-200 truncate">{leg.boardStation}</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Ride <span className="font-semibold text-slate-400">{leg.stops} stop{leg.stops !== 1 ? 's' : ''}</span> on{' '}
                    <span className="font-semibold" style={{ color: leg.lineColor }}>{leg.lineName.replace('NYCS - ', '')}</span>
                    <span className="text-slate-600"> · ~{leg.estimatedMinutes} min</span>
                  </div>
                  {leg.intermediateStations.length > 0 && leg.intermediateStations.length <= 8 && (
                    <div className="mt-1.5 text-[9px] text-slate-600 leading-relaxed">
                      via {leg.intermediateStations.join(' → ')}
                    </div>
                  )}
                  {leg.intermediateStations.length > 8 && (
                    <div className="mt-1.5 text-[9px] text-slate-600">
                      via {leg.intermediateStations.slice(0, 3).join(' → ')} → ... → {leg.intermediateStations.slice(-2).join(' → ')}
                    </div>
                  )}
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-2 mb-0.5">Alight</div>
                  <div className="text-xs font-bold text-slate-200 truncate">{leg.alightStation}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// --- Main App ---
function AppContent() {
  const [loading, setLoading] = useState(false);
  const [network, setNetwork] = useState<NetworkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originId, setOriginId] = useState<number | null>(null);
  const [destId, setDestId] = useState<number | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const routeReqRef = useRef(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch('/api/stations')
      .then(r => r.ok ? r.json() : r.json().then(b => { throw new Error(b.error || 'Failed'); }))
      .then((data: NetworkData) => setNetwork(data))
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleNodeClick = useCallback((id: number) => {
    if (!originId) { setOriginId(id); }
    else if (!destId && id !== originId) { setDestId(id); }
    else { setOriginId(id); setDestId(null); setRouteResult(null); }
  }, [originId, destId]);

  const resetRoute = useCallback(() => {
    setOriginId(null); setDestId(null); setRouteResult(null);
  }, []);

  useEffect(() => {
    if (!originId || !destId) return;
    const reqId = ++routeReqRef.current;
    setRouting(true);
    fetch(`/api/route?origin=${originId}&destination=${destId}`)
      .then(r => r.json())
      .then(data => {
        if (reqId !== routeReqRef.current) return;
        setRouteResult({
          path: data.path || [],
          actualDistance: data.actualDistance,
          weightedDistance: data.weightedDistance,
          instructions: data.instructions || null,
        });
      })
      .catch(() => {
        if (reqId === routeReqRef.current) setRouteResult({ path: [], actualDistance: null, weightedDistance: null, instructions: null });
      })
      .finally(() => { if (reqId === routeReqRef.current) setRouting(false); });
  }, [originId, destId]);

  const stations = useMemo(() => network?.stations.filter(Boolean) || [], [network]);
  const filteredStations = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return stations.filter(s => s.name?.toLowerCase().includes(q) && s.name !== 'Unknown Station').slice(0, 20);
  }, [stations, searchQuery]);

  const originStation = originId ? stations.find(s => s.id === originId) : null;
  const destStation = destId ? stations.find(s => s.id === destId) : null;
  const routePath = routeResult?.path || null;
  const instructions = routeResult?.instructions || null;

  // Build colored polyline segments from instruction legs
  const routeSegments = useMemo(() => {
    if (!routePath || !instructions?.legs.length) return [];
    return instructions.legs.map(leg => ({
      color: leg.lineColor,
      positions: routePath.slice(leg.pathStartIdx, leg.pathEndIdx + 1).map(n => [n.lat, n.lon] as [number, number]),
    }));
  }, [routePath, instructions]);

  return (
    <div className="h-screen bg-slate-900 flex flex-col font-sans text-slate-100 overflow-hidden">
      {/* Header */}
      <header className="glass-card border-b border-slate-700/50 z-20 relative">
        <div className="max-w-[1920px] mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2 rounded-lg hover:bg-slate-700/50 transition-colors" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle sidebar">
              <Menu className="w-5 h-5 text-slate-300" />
            </button>
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg shadow-indigo-500/20">
              <Train className="w-4 h-4 text-white" />
            </div>
            <h1 className="font-extrabold text-lg tracking-tight">NYC Rail<span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Map</span></h1>
          </div>
          <div className="hidden sm:block text-xs font-medium text-slate-500">Interactive transit routing · New York City</div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {/* Sidebar */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div initial={{ x: -320, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -320, opacity: 0 }} transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              className="w-80 glass-card border-r border-slate-700/50 flex flex-col z-10 overflow-y-auto absolute lg:relative h-full">
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Journey Planner</h2>
                  <button className="lg:hidden p-1 rounded hover:bg-slate-700/50" onClick={() => setSidebarOpen(false)} aria-label="Close"><X className="w-4 h-4 text-slate-500" /></button>
                </div>

                {/* Search */}
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input id="station-search" type="text" placeholder="Search stations..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-2.5 bg-slate-800/60 border border-slate-700/50 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all" />
                  {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-700"><X className="w-3.5 h-3.5 text-slate-500" /></button>}
                </div>

                <AnimatePresence>
                  {filteredStations.length > 0 && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className="bg-slate-800/40 rounded-xl border border-slate-700/30 overflow-hidden max-h-48 overflow-y-auto">
                      {filteredStations.map(s => (
                        <button key={s.id} onClick={() => { handleNodeClick(s.id); setSearchQuery(''); }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-slate-300 hover:bg-indigo-500/10 hover:text-indigo-300 transition-colors border-b border-slate-700/20 last:border-0 flex items-center justify-between">
                          <span className="truncate">{s.name}</span>
                          {s.lineColors && s.lineColors.length > 0 && (
                            <span className="flex gap-0.5 ml-2 shrink-0">
                              {s.lineColors.slice(0, 4).map((c, i) => <span key={i} className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />)}
                            </span>
                          )}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                {loading && (
                  <div className="flex flex-col items-center justify-center py-10 space-y-4">
                    <div className="w-8 h-8 border-[3px] border-slate-700 border-t-indigo-500 rounded-full animate-spin" />
                    <span className="text-xs font-semibold text-slate-500 animate-pulse">Mapping railways...</span>
                  </div>
                )}

                {error && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-xs font-semibold text-red-300 block">{error}</span>
                      <button onClick={() => window.location.reload()} className="text-[10px] font-bold text-red-400 hover:text-red-300 mt-2 underline">Retry</button>
                    </div>
                  </div>
                )}

                {!loading && !error && !network && (
                  <div className="text-center py-10"><Compass className="w-10 h-10 mx-auto mb-3 text-slate-600" /><p className="text-xs font-medium text-slate-500">Initializing...</p></div>
                )}

                {network && (
                  <div className="space-y-4">
                    {/* Origin / Destination */}
                    <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-700/30 space-y-3">
                      <div>
                        <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-[0.15em] mb-1.5">Origin</div>
                        <div className={`text-sm font-semibold p-3 rounded-lg border transition-all ${originStation ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'border-dashed border-slate-700 text-slate-600'}`}>
                          {originStation ? (originStation.name || `#${originStation.id}`) : 'Click map or search...'}
                        </div>
                      </div>
                      <div className="flex justify-center"><MoveRight className="w-3.5 h-3.5 text-slate-600 rotate-90" /></div>
                      <div>
                        <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-[0.15em] mb-1.5">Destination</div>
                        <div className={`text-sm font-semibold p-3 rounded-lg border transition-all ${destStation ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' : 'border-dashed border-slate-700 text-slate-600'}`}>
                          {destStation ? (destStation.name || `#${destStation.id}`) : 'Click map or search...'}
                        </div>
                      </div>
                    </div>

                    {/* Route Result */}
                    <AnimatePresence mode="wait">
                      {routing ? (
                        <motion.div key="routing" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                          className="bg-indigo-500/10 border border-indigo-500/20 p-5 rounded-xl text-center">
                          <div className="w-5 h-5 border-2 border-indigo-700 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3" />
                          <div className="text-xs font-semibold text-indigo-300">Calculating route...</div>
                        </motion.div>
                      ) : routeResult ? (
                        <motion.div key="result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                          {routeResult.path.length > 0 ? (
                            <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-5 rounded-xl shadow-xl shadow-indigo-500/10 relative overflow-hidden">
                              <div className="absolute top-0 right-0 p-3 opacity-10"><Navigation className="w-14 h-14" /></div>
                              <div className="relative">
                                <div className="text-[9px] font-extrabold text-indigo-200/70 uppercase tracking-[0.15em] mb-1">Optimal Route</div>
                                <div className="text-2xl font-black text-white">{routeResult.actualDistance !== null ? `${routeResult.actualDistance.toFixed(1)} km` : 'Found'}</div>
                                {instructions && (
                                  <div className="text-[10px] font-medium text-indigo-200/60 mt-0.5">
                                    {instructions.totalStops} stops · {instructions.transfers} transfer{instructions.transfers !== 1 ? 's' : ''} · ~{instructions.estimatedMinutes} min
                                  </div>
                                )}
                                <button onClick={resetRoute} className="mt-3 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider bg-white/15 hover:bg-white/25 text-white px-3 py-2 rounded-lg transition-colors w-full">
                                  <RotateCcw className="w-3 h-3" /> Reset
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-slate-800/60 border border-slate-700/40 p-5 rounded-xl">
                              <h3 className="text-sm font-bold text-slate-300">No Route Found</h3>
                              <p className="text-xs text-slate-500 mt-1">These stations are not connected.</p>
                              <button onClick={resetRoute} className="mt-3 text-[10px] font-bold uppercase bg-slate-700/50 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg w-full">Clear</button>
                            </div>
                          )}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>

                    {/* Directions */}
                    {instructions && instructions.legs.length > 0 && <RouteDirections instructions={instructions} />}

                    {/* Stats */}
                    <div className="pt-3 border-t border-slate-700/30">
                      <div className="text-[9px] font-extrabold text-slate-600 uppercase tracking-[0.15em] mb-2">Network</div>
                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                        {[['Stations', stations.length], ['Nodes', network.stats.totalNodes], ['Lines', network.stats.totalLines]].map(([label, val]) => (
                          <div key={String(label)} className="bg-slate-800/40 p-2.5 rounded-lg border border-slate-700/20">
                            <div className="text-slate-600 font-medium">{label}</div>
                            <div className="font-extrabold text-slate-300 text-sm">{typeof val === 'number' ? val.toLocaleString() : val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Map */}
        <div className="flex-1 relative">
          <MapContainer preferCanvas center={[40.7128, -74.006]} zoom={11} minZoom={10}
            maxBounds={[[40.37, -74.4], [41.02, -73.5]]} maxBoundsViscosity={1.0} className="w-full h-full z-0" zoomControl={false}>
            <TileLayer attribution='&copy; <a href="https://carto.com/">CARTO</a>' url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            {network && stations.length > 0 && <MapBounds nodes={stations} />}
            {routePath && routePath.length > 1 && <RouteBounds path={routePath} />}

            {/* Route polyline — colored per leg */}
            {routeSegments.length > 0 ? (
              routeSegments.map((seg, i) => (
                <React.Fragment key={`seg-${i}`}>
                  <Polyline positions={seg.positions} color={seg.color} weight={8} opacity={0.2} lineCap="round" lineJoin="round" />
                  <Polyline positions={seg.positions} color={seg.color} weight={4} opacity={0.9} lineCap="round" lineJoin="round" />
                </React.Fragment>
              ))
            ) : routePath && routePath.length > 1 ? (
              <>
                <Polyline positions={routePath.map(n => [n.lat, n.lon])} color="#818cf8" weight={8} opacity={0.2} lineCap="round" lineJoin="round" />
                <Polyline positions={routePath.map(n => [n.lat, n.lon])} color="#6366f1" weight={4} opacity={0.9} lineCap="round" lineJoin="round" />
              </>
            ) : null}

            {/* Station markers */}
            {stations.map(station => {
              const isOrigin = station.id === originId, isDest = station.id === destId, isSelected = isOrigin || isDest;
              return (
                <CircleMarker key={`st-${station.id}`} center={[station.lat, station.lon]}
                  radius={isSelected ? 7 : 3.5}
                  fillColor={isOrigin ? '#818cf8' : isDest ? '#c084fc' : '#64748b'}
                  fillOpacity={isSelected ? 1 : 0.5}
                  color={isSelected ? '#ffffff' : 'transparent'}
                  weight={isSelected ? 2 : 0}
                  eventHandlers={{ click: () => handleNodeClick(station.id) }}>
                  <Tooltip direction="top" offset={[0, -5]} opacity={1}>
                    {station.name || `Station #${station.id}`}
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>

          <div className="absolute bottom-5 right-5 z-10 glass-card rounded-xl p-3 text-[10px] font-medium text-slate-400 shadow-2xl">
            <span className="font-bold text-indigo-400 block mb-1">How to use</span>
            <span className="text-slate-500">Click a station → Origin</span><br />
            <span className="text-slate-500">Click another → Destination</span>
          </div>

          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} className="absolute top-4 left-4 z-10 glass-card p-2.5 rounded-xl lg:hidden shadow-xl" aria-label="Open sidebar">
              <Menu className="w-5 h-5 text-slate-300" />
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return <ErrorBoundary><AppContent /></ErrorBoundary>;
}
