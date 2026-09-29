"""
Script de cálculo de fotogramas de animación de isovistas a lo largo del corredor Norte-Sur de Morelia.
Calcula cada 20 metros la posición del observador, rumbo, isovista 2D por raycasting,
área instantánea, área acumulada disuelta y el hito urbano más cercano.
Genera los archivos 'mapa/datos/animacion.json' y 'mapa/datos/animacion.js'.
"""

import os
import sys
import time
import json
import geopandas as gpd
import numpy as np
from shapely.geometry import Point, LineString, Polygon, mapping
from shapely.ops import linemerge, transform
import pyproj

print("Iniciando cálculo de fotogramas de animación...")
t0 = time.time()

# 1. Cargar edificios (obstáculos)
gdf_edificios = gpd.read_file('edificios/edificios_norte_sur.geojson')
if gdf_edificios.crs is None:
    gdf_edificios = gdf_edificios.set_crs('EPSG:32614')

# 2. Cargar ruta
gdf_ruta = gpd.read_file('edificios/ruta_note_sur.geojson')
if gdf_ruta.crs != gdf_edificios.crs:
    gdf_ruta = gdf_ruta.to_crs(gdf_edificios.crs)
g_ruta = gdf_ruta.geometry.iloc[0]
if g_ruta.geom_type == 'MultiLineString':
    ruta_proj = linemerge(g_ruta)
else:
    ruta_proj = g_ruta

# 3. Cargar hitos urbanos (referencias)
gdf_ref = gpd.read_file('edificios/puntos_referencia_norte_sur.geojson')
if gdf_ref.crs != gdf_edificios.crs:
    gdf_ref = gdf_ref.to_crs(gdf_edificios.crs)

hitos_proj = []
for i, row in gdf_ref.iterrows():
    hitos_proj.append({
        "fid": int(row.get("fid", i + 1)),
        "nombre": str(row.get("Nombre", row.get("nombre", f"Hito {i+1}"))),
        "point": row.geometry
    })

# 4. Extraer contornos de obstáculos para Raycasting rápido
if hasattr(gdf_edificios.geometry, 'union_all'):
    obstaculos = gdf_edificios.geometry.union_all().boundary
else:
    obstaculos = gdf_edificios.geometry.unary_union.boundary

print(f"Obstáculos procesados en {time.time()-t0:.2f}s.")

# Transformer UTM Zona 14N -> WGS84
transformer = pyproj.Transformer.from_crs("EPSG:32614", "EPSG:4326", always_xy=True)

def to_wgs84_coords(geom):
    """Convierte un polígono Shapely en coordenadas WGS84 [lng, lat] redondeadas a 6 decimales."""
    coords_wgs84 = []
    for x, y in geom.exterior.coords:
        lng, lat = transformer.transform(x, y)
        coords_wgs84.append([round(lng, 6), round(lat, 6)])
    return coords_wgs84

def calc_isovista(p, obst, radio=180, num_rayos=90):
    angulos = np.linspace(0, 2 * np.pi, num_rayos, endpoint=False)
    pts = []
    for a in angulos:
        fx = p.x + radio * np.cos(a)
        fy = p.y + radio * np.sin(a)
        r = LineString([p, Point(fx, fy)])
        inter = r.intersection(obst)
        if inter.is_empty:
            pts.append((fx, fy))
        elif inter.geom_type == 'Point':
            pts.append((inter.x, inter.y))
        elif inter.geom_type == 'MultiPoint':
            pt_c = min(inter.geoms, key=lambda pt: p.distance(pt))
            pts.append((pt_c.x, pt_c.y))
        else:
            pts.append((fx, fy))
    return Polygon(pts)

# 5. Generar estaciones a lo largo de la ruta cada 20 metros
PASO_METROS = 20.0
total_len = ruta_proj.length
distancias = np.arange(0, total_len, PASO_METROS)
if distancias[-1] < total_len:
    distancias = np.append(distancias, total_len)

total_frames = len(distancias)
print(f"Calculando {total_frames} fotogramas a lo largo de {total_len:.1f} metros...")

frames = []
cum_poly = None

t_calc = time.time()
for idx, dist in enumerate(distancias):
    # Punto actual del observador
    p_curr = ruta_proj.interpolate(dist)
    lng_curr, lat_curr = transformer.transform(p_curr.x, p_curr.y)
    
    # Calcular rumbo (bearing) hacia adelante
    lookahead = min(dist + 6.0, total_len)
    if lookahead > dist:
        p_next = ruta_proj.interpolate(lookahead)
        dx = p_next.x - p_curr.x
        dy = p_next.y - p_curr.y
        bearing = (np.degrees(np.arctan2(dx, dy)) + 360) % 360
    else:
        p_prev = ruta_proj.interpolate(max(0, dist - 6.0))
        dx = p_curr.x - p_prev.x
        dy = p_curr.y - p_prev.y
        bearing = (np.degrees(np.arctan2(dx, dy)) + 360) % 360

    # Isovista
    poly_iso = calc_isovista(p_curr, obstaculos, radio=180, num_rayos=90)
    iso_area_m2 = round(poly_iso.area, 1)
    
    # Acumulación de área
    if cum_poly is None:
        cum_poly = poly_iso
    else:
        cum_poly = cum_poly.union(poly_iso)
        
    cum_area_m2 = round(cum_poly.area, 1)
    cum_area_ha = round(cum_area_m2 / 10000.0, 2)
    
    # Hito más cercano
    cercano = min(hitos_proj, key=lambda h: p_curr.distance(h["point"]))
    d_hito = p_curr.distance(cercano["point"])
    
    coords_wgs84 = to_wgs84_coords(poly_iso)
    
    frames.append({
        "frame": idx,
        "dist_m": round(float(dist), 1),
        "pct": round(float((dist / total_len) * 100.0), 1),
        "coords": [round(lng_curr, 6), round(lat_curr, 6)],
        "bearing": round(float(bearing), 1),
        "area_m2": iso_area_m2,
        "area_acum_m2": cum_area_m2,
        "area_acum_ha": cum_area_ha,
        "hito": {
            "fid": cercano["fid"],
            "nombre": cercano["nombre"],
            "dist_m": round(float(d_hito), 1)
        },
        "isovista": coords_wgs84
    })
    
    if (idx + 1) % 50 == 0 or idx == total_frames - 1:
        print(f"  Progreso: {idx+1}/{total_frames} fotogramas ({((idx+1)/total_frames)*100:.0f}%) en {time.time()-t_calc:.1f}s")

# Calcular rumbo suavizado para la cámara 3D (para giros estables en esquinas de 90°)
for i in range(total_frames):
    sin_sum = 0
    cos_sum = 0
    weight_sum = 0
    for offset in range(-2, 3):
        idx_f = max(0, min(total_frames - 1, i + offset))
        w = 1.0 / (1.0 + abs(offset))
        rad = np.radians(frames[idx_f]["bearing"])
        sin_sum += w * np.sin(rad)
        cos_sum += w * np.cos(rad)
        weight_sum += w
    smooth_deg = (np.degrees(np.arctan2(sin_sum, cos_sum)) + 360) % 360
    frames[i]["cam_bearing"] = round(float(smooth_deg), 1)

output_data = {
    "total_frames": total_frames,
    "longitud_total_m": round(total_len, 1),
    "paso_metros": PASO_METROS,
    "area_total_final_ha": frames[-1]["area_acum_ha"],
    "frames": frames
}

# Guardar en mapa/datos/animacion.json
ruta_json = "mapa/datos/animacion.json"
with open(ruta_json, "w", encoding="utf-8") as f:
    json.dump(output_data, f, ensure_ascii=False)

# Guardar en mapa/datos/animacion.js para ejecución estática sin servidor (doble clic)
ruta_js = "mapa/datos/animacion.js"
with open(ruta_js, "w", encoding="utf-8") as f:
    f.write("window.DATOS_ANIMACION = ")
    json.dump(output_data, f, ensure_ascii=False)
    f.write(";\n")

print(f"¡Cálculo finalizado con éxito en {time.time()-t0:.2f}s!")
print(f"Archivos guardados en: '{ruta_json}' ({os.path.getsize(ruta_json):,} bytes) y '{ruta_js}'.")
