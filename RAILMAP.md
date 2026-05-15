# Railmap 🚂🗺️

## Overview
**Railmap** is an interactive web application designed to visualize the railway network of any given country. Users can search for a country, explore its train stations (nodes), and calculate the fastest, most efficient travel routes between two selected stations.

## Core Features

### 1. Country Search & Network Generation
* **Global Search:** Users input the name of a country (e.g., "Germany", "Japan", "India").
* **Network Graph:** The app retrieves the country's railway system data and plots the train stations as nodes and the railways as connecting edges.

### 2. Interactive Map & Node Selection
* **Visual Exploration:** Users can pan and zoom across the plotted rail map.
* **Point-and-Click Routing:** Users interact directly with the map to set an "Origin" node and a "Destination" node by clicking on train stations.

### 3. Smart Pathfinding & Route Optimization
* **Fastest Route Calculation:** Upon selecting two nodes, the app calculates the optimal path, minimizing total travel time or distance.
* **Routing Algorithms:** Employs graph traversal and pathfinding algorithms (such as Dijkstra's or A* algorithm) applied to the rail network graph.

### 4. Journey Details
* **Step-by-Step Itinerary:** Displays the chronological list of stations to pass through.
* **Metrics:** Shows total estimated travel time, total distance, and required transfers/line changes.

---

## Technical Architecture (Proposed)

### Frontend
* **Framework:** React / Vite.
* **Map Rendering:** 
  * *Option A (Geographic):* **Leaflet**, **Mapbox GL JS**, or **Google Maps Platform** for accurate geographic rendering of the lines.
  * *Option B (Abstract Graph):* **D3.js** or **react-force-graph** if the visualization is purely topological (like a subway map).
* **Styling:** Tailwind CSS for a clean, modern UI.

### Data & Backend
* **Data Sources:** 
  * **OpenStreetMap (Overpass API):** Excellent open-source data for extracting global railway infrastructures (`railway=station` and `railway=rail`).
  * **Transitland / GTFS Feeds:** For more specific, schedule-based train data if available.
* **Backend:** Node.js server (Express) to handle heavy graph processing and caching, preventing the client's browser from acting slowly when processing thousands of country-wide nodes.
* **Routing Engine:** PostGIS with pgRouting, or a custom graph implementation in the backend using libraries like `graphology`.

## Next Steps for Development
1. **Data Acquisition Spike:** Create a script to pull railway data for a single test country using the Overpass API.
2. **Graph Construction:** Convert the geo-data into a queryable graph structure (Nodes = Stations, Edges = Tracks, Weights = Distance/Time).
3. **Map Prototype:** Render the nodes and edges on a React map.
4. **Pathfinding Implementation:** Implement the shortest-path algorithm and UI for node selection.
