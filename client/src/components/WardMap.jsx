import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api.js';

// Leaflet's default marker icons are resolved relative to the CSS file, which
// breaks under a bundler. Drawing the pin ourselves avoids the broken-image
// problem entirely and keeps it on-brand.
const pinIcon = L.divIcon({
  className: 'map-pin',
  html: '<span class="map-pin-dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// Whole of Kwara State, used when we have nothing better to centre on.
const KWARA_CENTRE = [8.9, 4.5];
const KWARA_ZOOM = 7;
const WARD_ZOOM = 13;
const LGA_ZOOM = 11;
const FLY_SECONDS = 1.2;

// Ray-casting point-in-polygon over a GeoJSON Polygon/MultiPolygon.
function inGeometry(g, lat, lng) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  return polys.some(([outer, ...holes]) => inRing(outer) && !holes.some(inRing));
}

/**
 * Tap-to-drop map for choosing where something goes.
 *
 * When GRID3 ward boundaries are loaded (Admin -> GRID3 ward boundaries) the
 * chosen ward is outlined and the map fits to it. Without them it falls back
 * to the average position of people already registered in the ward, and
 * failing that opens on the whole state for the user to pan.
 */
export default function WardMap({ lga, ward, sites, onChange, readOnly = false, height = 320 }) {
  const holder = useRef(null);
  const map = useRef(null);
  const tiles = useRef(null);
  const markers = useRef([]);
  const outline = useRef(null);
  const [boundary, setBoundary] = useState(null);
  const [centreNote, setCentreNote] = useState('');
  const [locating, setLocating] = useState(false);
  const [tileError, setTileError] = useState(false);

  // Create the map once.
  useEffect(() => {
    if (map.current || !holder.current) return;
    map.current = L.map(holder.current, { zoomControl: true, attributionControl: true })
      .setView(KWARA_CENTRE, KWARA_ZOOM);
    // Override the app's no-referrer policy only for map images. OSM requires
    // a valid Referer; strict-origin sends our origin without page paths/query data.
    const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      referrerPolicy: 'strict-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      errorTileUrl: L.Util.emptyImageUrl,
    });
    const failedTiles = new Set();
    const clearFailure = ({ tile }) => {
      failedTiles.delete(tile);
      setTileError(failedTiles.size > 0);
    };
    layer.on('tileerror', ({ tile }) => {
      failedTiles.add(tile);
      setTileError(true);
    });
    layer.on('tileunload', clearFailure);
    layer.on('tileload', (event) => {
      // Loading the blank error image is not a recovered map tile.
      if (event.tile.getAttribute('src') !== L.Util.emptyImageUrl) clearFailure(event);
    });
    tiles.current = layer;
    layer.addTo(map.current);

    // The project form can resize independently of the browser window.
    const observer = new ResizeObserver(() => map.current?.invalidateSize({ pan: false }));
    observer.observe(holder.current);
    return () => {
      observer.disconnect();
      layer.off();
      map.current?.remove();
      map.current = null;
      tiles.current = null;
    };
  }, []);

  // Clicking drops a pin.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const onClick = (e) => {
      if (readOnly || !ward) return;
      onChange([...sites, { lat: e.latlng.lat, lng: e.latlng.lng, label: '' }]);
    };
    m.on('click', onClick);
    return () => m.off('click', onClick);
  }, [sites, onChange, readOnly, ward]);

  // Glide to the LGA as soon as it is picked, then on to the ward, outlining
  // the ward from GRID3 when boundaries are loaded.
  useEffect(() => {
    const m = map.current;
    if (!m || !lga) return;
    let cancelled = false;
    const live = () => !cancelled && map.current;
    // A read-only map with pins frames the pins instead (see below).
    const move = !(readOnly && sites.length);
    const glideTo = (latlng, zoom) => move && map.current.flyTo(latlng, zoom, { duration: FLY_SECONDS });
    const glideToBounds = (bounds) => move
      && map.current.flyToBounds(bounds, { duration: FLY_SECONDS, padding: [12, 12] });

    setCentreNote('');
    outline.current?.remove();
    outline.current = null;
    setBoundary(null);

    const flyToLga = () => api.get('/geo/lga-view?lga=' + encodeURIComponent(lga)).then((v) => {
      if (!live()) return;
      if (v.bounds) glideToBounds(v.bounds);
      else if (v.centre) glideTo([v.centre.lat, v.centre.lng], LGA_ZOOM);
    });

    if (!ward) {
      flyToLga().catch(() => {});
      return () => { cancelled = true; };
    }

    const q = '?lga=' + encodeURIComponent(lga) + '&ward=' + encodeURIComponent(ward);
    api.get('/geo/ward-boundary' + q)
      .then((b) => {
        if (!live()) return;
        if (b.found) {
          outline.current = L.geoJSON(b.geometry, {
            style: { color: '#0b7a3e', weight: 2, fillOpacity: 0.06 },
            interactive: false,
          }).addTo(map.current);
          setBoundary(b.geometry);
          glideToBounds(outline.current.getBounds().pad(0.05));
          setCentreNote('Ward boundary from GRID3.');
          return;
        }
        return api.get('/geo/ward-centre' + q).then((r) => {
          if (!live()) return;
          if (r.lat != null) {
            glideTo([r.lat, r.lng], WARD_ZOOM);
            setCentreNote('Centred on ' + r.members + ' registration'
              + (r.members === 1 ? '' : 's') + ' in this ward.');
          } else {
            setCentreNote('No boundary for this ward yet, so the map shows the LGA. '
              + 'Zoom in to the right place.');
            return flyToLga();
          }
        });
      })
      .catch(() => { if (!cancelled) setCentreNote(''); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lga, ward]);

  // Redraw pins whenever they change.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = sites.map((s, i) => {
      const mk = L.marker([s.lat, s.lng], { icon: pinIcon, draggable: !readOnly }).addTo(m);
      if (s.label) mk.bindTooltip(s.label);
      if (!readOnly) {
        mk.on('dragend', () => {
          const p = mk.getLatLng();
          onChange(sites.map((x, xi) => (xi === i ? { ...x, lat: p.lat, lng: p.lng } : x)));
        });
      }
      return mk;
    });
    if (readOnly && sites.length) {
      m.fitBounds(L.latLngBounds(sites.map((s) => [s.lat, s.lng])).pad(0.3), { maxZoom: 15 });
    }
  }, [sites, onChange, readOnly]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        map.current?.setView([latitude, longitude], 16);
        onChange([...sites, { lat: latitude, lng: longitude, label: '' }]);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 });
  };

  const outside = boundary
    ? sites.filter((s) => !inGeometry(boundary, s.lat, s.lng)).length : 0;

  return (
    <div>
      <div ref={holder} style={{ height, borderRadius: 10, overflow: 'hidden' }} />
      {tileError && (
        <div role="status" className="hint" style={{ marginTop: 6 }}>
          Some map details could not load. Check your connection and retry before placing a pin.
          {' '}<button type="button" className="btn sm secondary" onClick={() => tiles.current?.redraw()}>
            Retry map
          </button>
        </div>
      )}
      {centreNote && <div className="hint" style={{ marginTop: 6 }}>{centreNote}</div>}
      {outside > 0 && (
        <div className="hint" style={{ marginTop: 4, color: 'var(--red-600)' }}>
          {outside === 1 ? '1 pin is' : outside + ' pins are'} outside {ward} ward. Check the
          location, or pick the ward the project is actually in.
        </div>
      )}
      {!readOnly && (
        <div className="btn-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn sm secondary" onClick={useMyLocation} disabled={locating}>
            {locating && <span className="spinner" />} Use my location
          </button>
          {sites.length > 0 && (
            <button type="button" className="btn sm secondary" onClick={() => onChange([])}>
              Clear {sites.length} pin{sites.length === 1 ? '' : 's'}
            </button>
          )}
          <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
            Tap the map to add a location. Drag a pin to move it.
          </span>
        </div>
      )}
    </div>
  );
}
