import axios from 'axios';

const query = `
[out:json][timeout:90];
(
  node["railway"="station"](40.477,-74.259,40.917,-73.700);
  way["railway"](40.477,-74.259,40.917,-73.700);
);
out body;
>;
out skel qt;
`;

console.log("Fetching Overpass...");
axios.post("https://overpass.kumi.systems/api/interpreter", `data=${encodeURIComponent(query)}`, {
  headers: { "User-Agent": "RailmapApp/1.0" }
}).then(res => {
  console.log("Elements:", res.data.elements.length);
}).catch(err => console.error(err));
