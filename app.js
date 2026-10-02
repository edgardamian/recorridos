/**
 * ==============================================================================
 * APLICACIÓN PRINCIPAL DE VISUALIZACIÓN CARTOGRÁFICA INTERACTIVA 2D / 3D
 * Proyecto: Análisis de Isovistas Urbanas - Corredor Norte-Sur de Morelia
 * Tecnologías: MapLibre GL JS (v5), JavaScript ES6+ asíncrono, AWS Terrarium DEM
 * ==============================================================================
 * Este script carga de manera asíncrona todos los conjuntos de datos GeoJSON
 * desde la carpeta 'datos/', configura las fuentes y capas del mapa, administra
 * los modos de visualización 3D (relieve topográfico y extrusión de edificios por
 * altura) y provee interactividad completa mediante popups, filtros y controles de cámara.
 */

// ==============================================================================
// 1. CONFIGURACIÓN, RUTAS Y ESTADO GLOBAL DE LA APLICACIÓN
// ==============================================================================

/** Rutas relativas a los datos dentro de la carpeta 'datos/' */
const DATA_PATHS = {
    metadata: "datos/metadata.json",
    ruta: "datos/ruta.geojson",
    referencias: "datos/referencias.geojson",
    envolvente: "datos/envolvente.geojson",
    edificios: "datos/edificios.geojson",
    animacion: "datos/animacion.json"
};

/** Estado reactivo de las capas y la cámara */
const appState = {
    basemapMode: "dark",          // "dark" o "satellite"
    terrain3DActive: false,       // ¿Relieve DEM 3D activo?
    terrainExaggeration: 1.0,     // Factor de exageración del terreno DEM
    buildings3DActive: false,     // ¿Extrusión 3D de edificios activa?
    buildingsExaggeration: 1.0,   // Multiplicador de altura de edificios
    buildingsMasterVisible: true, // ¿Visibilidad general de edificios?
    landmarksLabelsVisible: false, // ¿Etiquetas de texto de hitos visibles?
    landmarksData: [],            // Almacén en memoria de puntos de referencia
    landmarkMarkers: [],          // Referencias a los marcadores HTML en el mapa
    startMarker: null,            // (Migrado a capa nativa WebGL punto-inicio-circle)
    endMarker: null,              // (Migrado a capa nativa WebGL punto-fin-circle)
    activeLandmarkFid: null,      // FID del hito actualmente seleccionado/activo
    activePopup: null,            // Instancia del popup activo actualmente en pantalla
    // Estado de la animación de isovistas
    animData: null,               // Dataset con los 235 fotogramas
    animPlaying: false,           // ¿Animación reproduciéndose?
    animCurrentFrame: 0,          // Fotograma actual (0 a total-1)
    animSpeed: 1.0,               // Velocidad (½x, 1x, 2x, 4x)
    animCameraFollow: true,       // ¿Cámara sigue al observador?
    animCameraMode: "2d",         // Modo de seguimiento por defecto: "2d" (cenital) o "3d" (detrás del punto)
    animPlayerVisible: false,     // ¿Barra de controles visible? Inicia minimizado por defecto
    observerMarker: null,         // Marcador HTML del observador en el mapa
    profileProbeMarker: null,     // Marcador HTML del punto de muestreo al interactuar con las gráficas
    prebuiltFeatures: [],         // Features GeoJSON precalculadas para 60fps constantes
    animTimer: null,              // Temporizador del bucle de animación
    animLandmarkWindows: [],      // Array precalculado de hitos activos por cada fotograma
    animActiveFids: [],           // Array de FIDs de hitos activos en el fotograma actual
    // Estado de las herramientas de medición interactiva
    measure: {
        active: false,             // ¿Herramienta de medición activa?
        mode: null,                // 'distance' | 'area' | null
        coordinates: [],           // Coordenadas [lng, lat] de los vértices fijados
        markers: [],               // Marcadores HTML de los vértices en el mapa
        totalMarker: null,         // Marcador flotante con la tarjeta de resultado final
        isFinished: false,         // ¿Medición completada/cerrada?
        totalDistance: 0,          // Distancia acumulada en metros
        totalArea: 0               // Área acumulada en m²
    }
};

// Variable global para la instancia del mapa MapLibre
let map = null;

// Almacén de identificadores de las capas base de Carto Dark Matter para conmutación limpia
let cartoBaseLayerIds = [];


// ==============================================================================
// 2. INICIALIZACIÓN DEL MAPA CON MAPLIBRE GL JS
// ==============================================================================

/**
 * Inicializa el mapa base en modo cenital (2D) con estilo Carto Dark Matter.
 */
function initMap() {
    // Coordenadas iniciales por defecto (Centro del recorrido Morelia Norte-Sur)
    const initialCenter = [-101.1918, 19.7033];

    map = new maplibregl.Map({
        container: "map",
        // Estilo Carto Dark Matter: sin necesidad de tokens ni API keys de terceros
        style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        center: initialCenter,
        zoom: 14.8,
        pitch: 0,       // Vista cenital (ortogonal, 90° desde arriba)
        bearing: 0,     // Orientación norte
        maxPitch: 70,   // Límite de inclinación seguro que evita recorte de frustum y desaparición de capas
        maxZoom: 21,    // Límite superior de zoom seguro para sobre-escalado nítido
        preserveDrawingBuffer: true, // Permite capturas de pantalla nítidas HD vía toDataURL
        canvasContextAttributes: {
            preserveDrawingBuffer: true,
            antialias: true
        },
        attributionControl: false // Personalizado si se desea
    });

    // Agregar controles de navegación nativos (Zoom y brújula de orientación)
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    
    // Control de pantalla completa
    map.addControl(new maplibregl.FullscreenControl(), "top-left");

    // Control minimalista de Herramientas 3D y Medición (justo debajo de maximizar pantalla)
    const ctrlTools = {
        onAdd: () => document.getElementById("ctrl-tools-group"),
        onRemove: () => {}
    };
    map.addControl(ctrlTools, "top-left");

    // Control minimalista de Animación del Recorrido (en esquina inferior izquierda)
    const ctrlAnim = {
        onAdd: () => document.getElementById("ctrl-anim-group"),
        onRemove: () => {}
    };
    map.addControl(ctrlAnim, "bottom-left");

    // Control de escala métrica en la esquina inferior derecha
    map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-right");

    // Cuando el mapa y los estilos base terminen de cargarse, procesar los datos
    map.on("load", async () => {
        console.log("[MapLibre] Estilo base cargado exitosamente. Iniciando carga de datos GeoJSON...");
        await loadAllDatasets();
        setupLayers();
        setup3DFeatures();
        setupInteractivity();
        setupAnimation();
        setupUIEventListeners();
        setupMeasureTools();
        setupAdvancedFeatures();

        // Escuchar giros e inclinaciones manuales del mapa para mantener la orientación y UI en sincronía
        map.on("rotate", updateObserverArrowDirection);
        map.on("pitch", () => {
            if (!appState.animPlaying && !appState.animCameraFollow) {
                const isPitch3D = map.getPitch() > 20;
                updateCamModeUI(isPitch3D);
            }
        });

        hideLoadingOverlay();
    });
}


// ==============================================================================
// 3. CARGA ASÍNCRONA DE DATOS GEOJSON DESDE 'datos/'
// ==============================================================================

/**
 * Configuración de anclajes y desplazamientos espaciales calibrados por hito.
 * Separa deliberadamente las etiquetas de hitos contiguos en direcciones cardinales opuestas
 * (arriba, abajo, izquierda, derecha) para evitar que se empalmen visualmente en 2D y 3D,
 * permitiendo que ambos permanezcan encendidos con suficiente tiempo para ser leídos con calma.
 */
const LANDMARK_LABEL_CONFIG = {
    1:  { anchor: "bottom",       offset: [0, -1.35] },  // Fuente del Pípila (Norte / Inicio)
    2:  { anchor: "left",         offset: [1.35, 0] },   // Casa de la cultura (Este)
    3:  { anchor: "right",        offset: [-1.35, 0] },  // Plaza del Carmen (Oeste)
    4:  { anchor: "right",        offset: [-1.45, 0] },  // Jardín San José (Oeste, opuesto al templo)
    5:  { anchor: "left",         offset: [1.45, 0] },   // Templo de San José (Este, opuesto al jardín)
    6:  { anchor: "bottom",       offset: [0, -1.45] },  // Templo de San Francisco (Norte / Arriba)
    7:  { anchor: "top",          offset: [0, 1.45] },   // Casa de las Artesanías (Sur / Abajo)
    8:  { anchor: "right",        offset: [-1.45, 0] },  // Plaza Valladolid (Oeste / Izquierda)
    9:  { anchor: "left",         offset: [1.45, 0] },   // Plaza Melchor Ocampo (Este / Derecha)
    10: { anchor: "bottom",       offset: [0, -1.55] },  // Catedral de Morelia (Norte / Arriba)
    11: { anchor: "right",        offset: [-1.45, 0] },  // Plaza de Armas (Oeste / Izquierda)
    12: { anchor: "bottom",       offset: [0, -1.45] },  // Palacio Clavijero (Norte / Arriba)
    13: { anchor: "left",         offset: [1.45, 0] },   // Biblioteca Universitaria (Este / Derecha)
    14: { anchor: "right",        offset: [-1.45, 0] },  // Mercado de Dulces (Oeste / Izquierda)
    15: { anchor: "right",        offset: [-1.35, 0] },  // Palacio Municipal (Oeste / Izquierda)
    16: { anchor: "bottom",       offset: [0, -1.45] },  // Museo del Poder Judicial (Norte / Arriba)
    17: { anchor: "bottom",       offset: [0, -1.45] },  // Cerrada de San Agustín (Norte / Arriba)
    18: { anchor: "right",        offset: [-1.45, 0] },  // Plaza de San Agustín (Oeste / Izquierda)
    19: { anchor: "top",          offset: [0, 1.45] },   // Templo de San Agustín (Sur / Abajo)
    20: { anchor: "left",         offset: [1.45, 0] },   // Casa Natal de Morelos (Este / Derecha)
    21: { anchor: "bottom",       offset: [0, -1.35] },  // Fuente del Ángel (Norte / Arriba)
    22: { anchor: "bottom-right", offset: [-1.2, -0.8] },// Plazuela de Capuchinas (Noroeste)
    23: { anchor: "top-left",     offset: [1.2, 0.8] },  // Templo de Capuchinas (Sureste)
    24: { anchor: "right",        offset: [-1.35, 0] },  // Mercado Independencia (Oeste / Izquierda)
    25: { anchor: "left",         offset: [1.35, 0] },   // Plaza Carrillo (Este / Derecha)
    26: { anchor: "top",          offset: [0, 1.35] }    // Calzada Juárez (Sur / Fin)
};

/**
 * Carga todos los archivos GeoJSON y metadatos en paralelo usando Promise.all.
 */
async function loadAllDatasets() {
    try {
        updateLoadingText("Cargando conjuntos de datos espaciales...", "Leyendo ruta, hitos, alcance visual y estructuras urbanas");

        // 1. Modo Estático (sin servidor / doble clic directo en index.html):
        // Se leen directamente las variables globales inyectadas por los scripts de datos/
        let metaRes = window.DATOS_METADATA;
        let rutaRes = window.DATOS_RUTA;
        let refRes = window.DATOS_REFERENCIAS;
        let envRes = window.DATOS_ENVOLVENTE;
        let edifRes = window.DATOS_EDIFICIOS;
        let animRes = window.DATOS_ANIMACION;

        // 2. Modo Servidor (fallback a fetch si los scripts no se incluyeron en el HTML):
        if (!metaRes || !rutaRes || !refRes || !envRes || !edifRes || !animRes) {
            [metaRes, rutaRes, refRes, envRes, edifRes, animRes] = await Promise.all([
                metaRes || fetch(DATA_PATHS.metadata).then(r => r.json()),
                rutaRes || fetch(DATA_PATHS.ruta).then(r => r.json()),
                refRes || fetch(DATA_PATHS.referencias).then(r => r.json()),
                envRes || fetch(DATA_PATHS.envolvente).then(r => r.json()),
                edifRes || fetch(DATA_PATHS.edificios).then(r => r.json()),
                animRes || fetch(DATA_PATHS.animacion).then(r => r.json()).catch(() => null)
            ]);
        }

        appState.animData = animRes;

        console.log("[Datos] Metadatos cargados:", metaRes);
        console.log(`[Datos] Edificios: ${edifRes.features.length} | Hitos: ${refRes.features.length}`);

        // Inyectar anclajes y desplazamientos espaciales calculados a cada hito para evitar empalmes
        if (refRes && refRes.features) {
            refRes.features.forEach(feat => {
                const fid = feat.properties && feat.properties.fid;
                const cfg = LANDMARK_LABEL_CONFIG[fid] || { anchor: "bottom", offset: [0, -1.35] };
                feat.properties.label_anchor = cfg.anchor;
                feat.properties.label_offset = cfg.offset;
            });
        }

        // Actualizar estadísticas en las tarjetas del panel de control
        updateStatsUI(metaRes, edifRes);

        // Guardar hitos en el estado para el buscador
        appState.landmarksData = refRes.features;
        renderLandmarksList(refRes.features);

        // Registrar las fuentes GeoJSON en el mapa con parámetros balanceados para evitar desborde de vértices WebGL (65,535) y caídas de teselas
        map.addSource("ruta_src", { type: "geojson", data: rutaRes, tolerance: 0, buffer: 128, maxzoom: 20 });
        map.addSource("referencias_src", { type: "geojson", data: refRes, tolerance: 0, buffer: 128, maxzoom: 20 });
        map.addSource("envolvente_src", { type: "geojson", data: envRes, tolerance: 0, buffer: 128, maxzoom: 20 });
        map.addSource("edificios_src", {
            type: "geojson",
            data: edifRes,
            tolerance: 0.08,    // Preserva las esquinas y detalles de cada edificio sin inflar el búfer de vértices WebGL
            buffer: 64,         // Búfer idóneo: evita cortes en los bordes de teselas sin duplicar innecesariamente polígonos
            maxzoom: 20         // Detalle submétrico (z20 = ~15 cm/pixel). Zooms más cercanos sobre-escalan con máxima fidelidad
        });

        // Registrar fuentes GeoJSON nativas para el Punto de Inicio y Punto de Fin
        // Procesadas en WebGL por GPU para anclaje milimétrico y cero retraso/desplazamiento al mover el mapa
        const iniCoords = (metaRes.punto_inicio && metaRes.punto_inicio.coords) || [-101.188794, 19.710675];
        const iniNombre = (metaRes.punto_inicio && metaRes.punto_inicio.nombre) || "Inicio Recorrido (Norte)";
        map.addSource("punto_inicio_src", {
            type: "geojson",
            data: {
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    geometry: { type: "Point", coordinates: iniCoords },
                    properties: { tipo: "Punto de Inicio", nombre: iniNombre }
                }]
            }
        });

        const finCoords = (metaRes.punto_fin && metaRes.punto_fin.coords) || [-101.19529, 19.695907];
        const finNombre = (metaRes.punto_fin && metaRes.punto_fin.nombre) || "Fin Recorrido (Sur)";
        map.addSource("punto_fin_src", {
            type: "geojson",
            data: {
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    geometry: { type: "Point", coordinates: finCoords },
                    properties: { tipo: "Punto de Fin", nombre: finNombre }
                }]
            }
        });

    } catch (error) {
        console.error("[Error] Falló la carga de datos GeoJSON:", error);
        updateLoadingText("Error al cargar los datos", "Verifica que la carpeta 'datos/' contenga todos los archivos.");
    }
}


// ==============================================================================
// 4. CONFIGURACIÓN Y ESTILIZADO DE CAPAS (2D Y 3D)
// ==============================================================================

/**
 * Agrega y estiliza las capas vectoriales sobre el mapa.
 */
function setupLayers() {
    // Identificar todas las capas base del estilo Carto Dark Matter para conmutación limpia
    cartoBaseLayerIds = map.getStyle().layers
        .filter(l => l.source === "carto" || l.id === "background")
        .map(l => l.id);

    // -------------------------------------------------------------------------
    // CAPA 0: MAPA SATELITAL (ESRI WORLD IMAGERY - ALTA RESOLUCIÓN)
    // -------------------------------------------------------------------------
    map.addSource("satellite_src", {
        type: "raster",
        tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        ],
        tileSize: 256,
        maxzoom: 19
    });

    map.addLayer({
        id: "satellite-layer",
        type: "raster",
        source: "satellite_src",
        layout: { visibility: "none" } // Inicia apagada (Dark Matter por defecto)
    });

    // -------------------------------------------------------------------------
    // CAPA 1: EDIFICACIONES URBANAS (2D BASE)
    // -------------------------------------------------------------------------
    map.addLayer({
        id: "edificios-fill",
        type: "fill",
        source: "edificios_src",
        layout: { visibility: "visible" },
        paint: {
            "fill-color": "#1e293b",
            "fill-opacity": 0.85,
            "fill-outline-color": "rgba(51, 65, 85, 0.4)"
        }
    });

    // -------------------------------------------------------------------------
    // CAPA 2: ENVOLVENTE VISUAL ACUMULADA (ISOVISTAS DISUELTAS)
    // Polígono de cobertura visual combinada a lo largo del recorrido.
    // -------------------------------------------------------------------------
    map.addLayer({
        id: "envolvente-fill",
        type: "fill",
        source: "envolvente_src",
        layout: { visibility: "visible" },
        paint: {
            "fill-color": "#ef4444",
            "fill-opacity": 0.38
        }
    });

    // Borde delimitador de la envolvente
    map.addLayer({
        id: "envolvente-line",
        type: "line",
        source: "envolvente_src",
        layout: { visibility: "visible" },
        paint: {
            "line-color": "#f87171",
            "line-width": 2,
            "line-dasharray": [2, 1]
        }
    });

    // -------------------------------------------------------------------------
    // CAPA 2.5: ÁREAS DE ANIMACIÓN DE ISOVISTAS (PROGRESIVA E INSTANTÁNEA)
    // -------------------------------------------------------------------------
    // Fuente y capas para el área acumulada progresiva descubierta
    map.addSource("anim_acum_src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    map.addLayer({
        id: "anim-acum-fill",
        type: "fill",
        source: "anim_acum_src",
        layout: { visibility: "visible" },
        paint: {
            "fill-color": "#ef4444",
            "fill-opacity": 0.38
        }
    });

    map.addLayer({
        id: "anim-acum-line",
        type: "line",
        source: "anim_acum_src",
        layout: { visibility: "visible" },
        paint: {
            "line-color": "#f87171",
            "line-width": 1.6,
            "line-dasharray": [2, 1]
        }
    });

    // Fuente y capas para la isovista instantánea (campo visual actual en tiempo real)
    map.addSource("anim_actual_src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    // Resplandor difuso exterior del haz visual
    map.addLayer({
        id: "anim-actual-glow",
        type: "line",
        source: "anim_actual_src",
        layout: { visibility: "visible" },
        paint: {
            "line-color": "#38bdf8",
            "line-width": 7,
            "line-blur": 3,
            "line-opacity": 0.65
        }
    });

    // Relleno del campo visual actual
    map.addLayer({
        id: "anim-actual-fill",
        type: "fill",
        source: "anim_actual_src",
        layout: { visibility: "visible" },
        paint: {
            "fill-color": "#38bdf8",
            "fill-opacity": 0.5
        }
    });

    // Borde nítido blanco del campo visual actual
    map.addLayer({
        id: "anim-actual-line",
        type: "line",
        source: "anim_actual_src",
        layout: { visibility: "visible" },
        paint: {
            "line-color": "#ffffff",
            "line-width": 2
        }
    });

    // -------------------------------------------------------------------------
    // CAPA 3: RUTA PEATONAL DEL OBSERVADOR
    // Trazado del recorrido norte a sur con efecto resplandor (glow).
    // -------------------------------------------------------------------------
    // Halo resplandeciente exterior
    map.addLayer({
        id: "ruta-halo",
        type: "line",
        source: "ruta_src",
        layout: { visibility: "visible" },
        paint: {
            "line-color": "#38bdf8",
            "line-width": 8,
            "line-opacity": 0.35,
            "line-blur": 3
        }
    });

    // Línea central sólida
    map.addLayer({
        id: "ruta-line",
        type: "line",
        source: "ruta_src",
        layout: { visibility: "visible" },
        paint: {
            "line-color": "#38bdf8",
            "line-width": 3.8
        }
    });

    // -------------------------------------------------------------------------
    // CAPA 4: PUNTOS DE REFERENCIA (HITOS DESTACADOS EN AMARILLO)
    // -------------------------------------------------------------------------
    // Halo resplandeciente unificado para los puntos de referencia
    map.addLayer({
        id: "referencias-glow",
        type: "circle",
        source: "referencias_src",
        layout: { visibility: "visible" },
        paint: {
            "circle-color": "#fbbf24",
            "circle-radius": 13,
            "circle-opacity": 0.35,
            "circle-blur": 0.5
        }
    });

    map.addLayer({
        id: "referencias-circles",
        type: "circle",
        source: "referencias_src",
        layout: { visibility: "visible" },
        paint: {
            "circle-color": "#fbbf24",
            "circle-radius": 6.5,
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 2.5
        }
    });

    // Capa de halo resplandeciente para el hito actualmente seleccionado (activo)
    map.addLayer({
        id: "referencias-active-glow",
        type: "circle",
        source: "referencias_src",
        layout: { visibility: "visible" },
        filter: ["==", ["to-string", ["coalesce", ["get", "fid"], ""]], "__none__"],
        paint: {
            "circle-color": "#fbbf24",
            "circle-radius": 15,
            "circle-opacity": 0.45,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5
        }
    });

    // -------------------------------------------------------------------------
    // CAPA 4.1: ETIQUETAS NATIVAS DE HITOS EN WEBGL (CERO RETRASO A 60+ FPS)
    // Renderizadas por GPU dentro del mismo flujo de fotogramas que el mapa y el relieve
    // -------------------------------------------------------------------------
    map.addLayer({
        id: "referencias-labels",
        type: "symbol",
        source: "referencias_src",
        layout: {
            "visibility": appState.landmarksLabelsVisible ? "visible" : "none",
            "text-field": ["get", "nombre"],
            "text-font": ["Montserrat Medium", "Open Sans Regular"],
            "text-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                12, 10.5,
                14, 11.5,
                16, 13,
                18, 14.5
            ],
            "text-offset": ["coalesce", ["get", "label_offset"], ["literal", [0, -1.25]]],
            "text-anchor": ["coalesce", ["get", "label_anchor"], "bottom"],
            "text-max-width": 9,
            "text-line-height": 1.15,
            "text-justify": "auto",
            "text-pitch-alignment": "viewport",
            "text-rotation-alignment": "viewport",
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-padding": 3,
            "text-optional": true
        },
        paint: {
            "text-color": "#f8fafc",
            "text-halo-color": "#090d16",
            "text-halo-width": 2.2,
            "text-halo-blur": 0.5
        }
    });

    // Etiqueta nativa destacada para el hito actualmente seleccionado (activo)
    map.addLayer({
        id: "referencias-active-label",
        type: "symbol",
        source: "referencias_src",
        layout: {
            "visibility": "visible",
            "text-field": ["get", "nombre"],
            "text-font": ["Open Sans Bold", "Montserrat Medium"],
            "text-size": 13,
            "text-offset": ["coalesce", ["get", "label_offset"], ["literal", [0, -1.35]]],
            "text-anchor": ["coalesce", ["get", "label_anchor"], "bottom"],
            "text-max-width": 9,
            "text-line-height": 1.15,
            "text-justify": "auto",
            "text-pitch-alignment": "viewport",
            "text-rotation-alignment": "viewport",
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-padding": 3,
            "text-optional": false
        },
        filter: ["==", ["to-string", ["coalesce", ["get", "fid"], ""]], "__none__"],
        paint: {
            "text-color": "#fbbf24",
            "text-halo-color": "#090d16",
            "text-halo-width": 2.8,
            "text-halo-blur": 0.5
        }
    });

    // -------------------------------------------------------------------------
    // CAPA 5: PUNTO DE INICIO Y PUNTO DE FIN (RENDERIZADOS EN WEBGL NATIVO)
    // Cero retraso en paneo/inclinación, anclaje estricto al terreno y estilo armónico
    // -------------------------------------------------------------------------
    const chkIniEl = document.getElementById("chk-inicio");
    const iniInitVis = (chkIniEl && !chkIniEl.checked) ? "none" : "visible";

    if (map.getSource("punto_inicio_src")) {
        // Halo de resplandor esmeralda para el Punto de Inicio
        map.addLayer({
            id: "punto-inicio-glow",
            type: "circle",
            source: "punto_inicio_src",
            layout: { visibility: iniInitVis },
            paint: {
                "circle-color": "#10b981",
                "circle-radius": 10.5,
                "circle-opacity": 0.40,
                "circle-blur": 0.5
            }
        });

        // Círculo central con borde de alto contraste
        map.addLayer({
            id: "punto-inicio-circle",
            type: "circle",
            source: "punto_inicio_src",
            layout: { visibility: iniInitVis },
            paint: {
                "circle-color": "#10b981",
                "circle-radius": 5.5,
                "circle-stroke-color": "#0f172a",
                "circle-stroke-width": 2.0
            }
        });
    }

    const chkFinEl = document.getElementById("chk-fin");
    const finInitVis = (chkFinEl && !chkFinEl.checked) ? "none" : "visible";

    if (map.getSource("punto_fin_src")) {
        // Halo de resplandor carmesí para el Punto de Fin
        map.addLayer({
            id: "punto-fin-glow",
            type: "circle",
            source: "punto_fin_src",
            layout: { visibility: finInitVis },
            paint: {
                "circle-color": "#ef4444",
                "circle-radius": 10.5,
                "circle-opacity": 0.40,
                "circle-blur": 0.5
            }
        });

        // Círculo central con borde de alto contraste
        map.addLayer({
            id: "punto-fin-circle",
            type: "circle",
            source: "punto_fin_src",
            layout: { visibility: finInitVis },
            paint: {
                "circle-color": "#ef4444",
                "circle-radius": 5.5,
                "circle-stroke-color": "#0f172a",
                "circle-stroke-width": 2.0
            }
        });
    }

    // -------------------------------------------------------------------------
    // CAPAS DE MEDICIÓN INTERACTIVA (DISTANCIA Y ÁREA)
    // -------------------------------------------------------------------------
    map.addSource("measure_polygon_src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    map.addSource("measure_line_src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    map.addSource("measure_rubberband_src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    map.addSource("measure_points_src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    // Relleno de polígono medido
    map.addLayer({
        id: "measure-polygon-fill",
        type: "fill",
        source: "measure_polygon_src",
        paint: {
            "fill-color": "#38bdf8",
            "fill-opacity": 0.24
        }
    });

    // Contorno de polígono medido
    map.addLayer({
        id: "measure-polygon-stroke",
        type: "line",
        source: "measure_polygon_src",
        paint: {
            "line-color": "#38bdf8",
            "line-width": 2.2,
            "line-dasharray": [2, 2]
        }
    });

    // Resplandor de línea de medición
    map.addLayer({
        id: "measure-line-glow",
        type: "line",
        source: "measure_line_src",
        paint: {
            "line-color": "#38bdf8",
            "line-width": 7,
            "line-opacity": 0.35
        }
    });

    // Línea de medición sólida
    map.addLayer({
        id: "measure-line-main",
        type: "line",
        source: "measure_line_src",
        layout: {
            "line-cap": "round",
            "line-join": "round"
        },
        paint: {
            "line-color": "#38bdf8",
            "line-width": 3.6
        }
    });

    // Guía elástica dinámica (rubberband) bajo el cursor
    map.addLayer({
        id: "measure-rubberband-line",
        type: "line",
        source: "measure_rubberband_src",
        layout: {
            "line-cap": "round",
            "line-join": "round"
        },
        paint: {
            "line-color": "#fbbf24",
            "line-width": 2.2,
            "line-dasharray": [3, 2]
        }
    });

    // Vértices de medición
    map.addLayer({
        id: "measure-points-circle",
        type: "circle",
        source: "measure_points_src",
        paint: {
            "circle-radius": 5.5,
            "circle-color": "#0f172a",
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#38bdf8"
        }
    });
}


// ==============================================================================
// 5. CONTROLADORES 3D (TERRENO DEM Y EDIFICIOS EXTRUIDOS)
// ==============================================================================

/**
 * Prepara las fuentes y capas necesarias para visualización 3D:
 * 1. Fuente DEM Raster para Terreno 3D (AWS Terrarium).
 * 2. Capa 'fill-extrusion' para edificios con altura variable.
 */
function setup3DFeatures() {
    // 1. Agregar la fuente global de elevación DEM (tiles Terrarium en AWS)
    // maxzoom: 14 evita discrepancias de resolución con las capas base y la advertencia WebGL de elevación
    map.addSource("terrain-dem-src", {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 14
    });

    // 2. Agregar la capa de extrusión 3D de edificios vinculada a 'altura'
    // Se inserta antes de 'referencias-circles' para que los hitos y la ruta permanezcan visibles.
    map.addLayer({
        id: "edificios-3d",
        type: "fill-extrusion",
        source: "edificios_src",
        layout: {
            visibility: "none" // Inicia apagada en modo 2D cenital
        },
        paint: {
            // Rampa de color dinámica interpolada según la altura en metros del edificio
            "fill-extrusion-color": [
                "interpolate",
                ["linear"],
                ["coalesce", ["get", "altura"], 3],
                0,  "#1e293b", // Lotes o estructuras rasas
                3,  "#334155", // 1 nivel (~3 m)
                6,  "#475569", // 2 niveles (~6 m)
                9,  "#64748b", // 3 niveles (~9 m)
                12, "#0284c7", // 4 niveles (~12 m)
                20, "#38bdf8", // Media altura (~20 m)
                35, "#f59e0b"  // Torres o hitos altos (~35 m)
            ],
            // Altura de extrusión vertical con mínimo garantizado (3.0 m) para evitar que el terreno tape edificios bajos
            "fill-extrusion-height": [
                "*",
                ["max", ["coalesce", ["get", "altura"], 3.5], 3.0],
                appState.buildingsExaggeration
            ],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.90
        }
    }, map.getLayer("referencias-glow") ? "referencias-glow" : (map.getLayer("referencias-circles") ? "referencias-circles" : undefined));
}

/**
 * Cambia el mapa base entre estilo oscuro (Carto) e imagen satelital de alta resolución (ESRI).
 * Oculta completamente las capas del mapa base oscuro al activar satélite para evitar que queden
 * por debajo, se filtren visualmente o causen artefactos/desaparición en perspectiva 3D.
 * @param {'dark' | 'satellite'} mode - Estilo de mapa base deseado
 */
function setBasemap(mode) {
    if (!map) return;
    appState.basemapMode = mode;
    const btnDark = document.getElementById("btn-bm-dark");
    const btnSat = document.getElementById("btn-bm-satellite");

    if (mode === "satellite") {
        if (map.getLayer("satellite-layer")) {
            map.setLayoutProperty("satellite-layer", "visibility", "visible");
        }
        // Ocultar todas las capas base de Carto para evitar que queden por debajo
        cartoBaseLayerIds.forEach(id => {
            if (map.getLayer(id)) {
                map.setLayoutProperty(id, "visibility", "none");
            }
        });

        if (btnDark) btnDark.classList.remove("active");
        if (btnSat) btnSat.classList.add("active");
    } else {
        if (map.getLayer("satellite-layer")) {
            map.setLayoutProperty("satellite-layer", "visibility", "none");
        }

        // Restaurar visibilidad de las capas base Carto Dark
        cartoBaseLayerIds.forEach(id => {
            if (map.getLayer(id)) {
                map.setLayoutProperty(id, "visibility", "visible");
            }
        });
        if (btnDark) btnDark.classList.add("active");
        if (btnSat) btnSat.classList.remove("active");
    }
}

/**
 * Aplica la exageración del relieve mediante los botones (Real 1x, 2x, 3x).
 * Si el relieve 3D está apagado, lo enciende automáticamente.
 * @param {number|string} val - Factor de escala de relieve (1.0, 2.0, 3.0)
 */
function setTerrainExaggeration(val) {
    const num = parseFloat(val);
    appState.terrainExaggeration = num;

    // Actualizar botones UI
    document.querySelectorAll('#row-terrain-exag .btn-exag').forEach(btn => {
        if (parseFloat(btn.dataset.val) === num) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Si el terreno 3D no está encendido, activarlo automáticamente
    if (!appState.terrain3DActive) {
        toggleTerrain3D(true);
    } else if (map) {
        map.setTerrain({ source: "terrain-dem-src", exaggeration: appState.terrainExaggeration });
    }
}

/**
 * Aplica el multiplicador de altura de los edificios mediante los botones (Real 1x, 2x, 3x).
 * Si los edificios 3D están apagados, los enciende automáticamente.
 * @param {number|string} val - Factor de escala de altura (1.0, 2.0, 3.0)
 */
function setBuildingsExaggeration(val) {
    const num = parseFloat(val);
    appState.buildingsExaggeration = num;

    // Actualizar botones UI
    document.querySelectorAll('#row-buildings-exag .btn-exag').forEach(btn => {
        if (parseFloat(btn.dataset.val) === num) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Si los edificios 3D no están encendidos, activarlos automáticamente
    if (!appState.buildings3DActive) {
        toggleBuildings3D(true);
    }

    if (map && map.getLayer("edificios-3d")) {
        map.setPaintProperty("edificios-3d", "fill-extrusion-height", [
            "*",
            ["max", ["coalesce", ["get", "altura"], 3.5], 3.0],
            appState.buildingsExaggeration
        ]);
    }
}

const updateTerrainExaggeration = setTerrainExaggeration;
const updateBuildingsExaggeration = setBuildingsExaggeration;

/**
 * Activa o desactiva la elevación topográfica del Terreno 3D.
 * Aplica el factor actual de exageración (appState.terrainExaggeration).
 * @param {boolean} [forceState] - Estado opcional para forzar encendido o apagado
 */
function toggleTerrain3D(forceState) {
    if (forceState !== undefined) {
        appState.terrain3DActive = forceState;
    } else {
        appState.terrain3DActive = !appState.terrain3DActive;
    }

    const chk = document.getElementById("chk-terreno-3d");
    if (chk) chk.checked = appState.terrain3DActive;

    try {
        if (appState.terrain3DActive) {
            map.setTerrain({ source: "terrain-dem-src", exaggeration: appState.terrainExaggeration });
            if (map.setSourceTileLodParams) {
                map.setSourceTileLodParams(10, 4);
            }
        } else {
            // Desactivar elevación y regresar a plano 2D
            map.setTerrain(null);
        }
    } catch (e) {
        console.warn("[Terreno 3D] Error al cambiar estado:", e);
    }
}

/**
 * Activa o desactiva la extrusión volumétrica 3D de los edificios.
 * @param {boolean} [forceState] - Estado opcional para forzar encendido o apagado
 */
function toggleBuildings3D(forceState) {
    if (forceState !== undefined) {
        appState.buildings3DActive = forceState;
    } else {
        appState.buildings3DActive = !appState.buildings3DActive;
    }

    const chk = document.getElementById("chk-edificios-3d");
    if (chk) chk.checked = appState.buildings3DActive;

    try {
        if (appState.buildings3DActive) {
            // Mostrar capa 3D si la visibilidad general de edificios está activa
            if (appState.buildingsMasterVisible) {
                map.setLayoutProperty("edificios-3d", "visibility", "visible");
                map.setLayoutProperty("edificios-fill", "visibility", "none");
            }
        } else {
            // Ocultar capa 3D y restaurar capa plana 2D
            map.setLayoutProperty("edificios-3d", "visibility", "none");
            if (appState.buildingsMasterVisible) {
                map.setLayoutProperty("edificios-fill", "visibility", "visible");
            }
        }
    } catch (e) {
        console.warn("[Edificios 3D] Error al cambiar estado:", e);
    }
}

/**
 * Ajusta la perspectiva de la cámara entre vista cenital (2D) y oblicua (3D).
 * En 3D, orienta la cámara DETRÁS del observador con pitch de 58° si hay recorrido activo.
 * @param {'2d' | '3d' | 'fit'} mode - Modo deseado
 */
function setCameraView(mode) {
    if (!map) return;
    if (mode === "2d") {
        appState.animCameraMode = "2d";
        let targetCenter = map.getCenter();
        if (appState.animData && appState.animData.frames) {
            const curFrame = appState.animData.frames[appState.animCurrentFrame] || appState.animData.frames[0];
            targetCenter = curFrame.coords;
        }
        map.easeTo({
            center: targetCenter,
            pitch: 0,
            bearing: 0,
            offset: [0, 0],
            duration: 800
        });
        updateCamModeUI(false);
    } else if (mode === "3d") {
        appState.animCameraMode = "3d";
        // Si los edificios 3D están apagados, activarlos para enriquecer la experiencia visual
        if (!appState.buildings3DActive) {
            toggleBuildings3D(true);
        }
        let targetCenter = [-101.1918, 19.7033];
        let targetBearing = -15;

        // Si tenemos datos de animación, ubicarse exactamente DETRÁS del punto del observador
        if (appState.animData && appState.animData.frames) {
            const curFrame = appState.animData.frames[appState.animCurrentFrame] || appState.animData.frames[0];
            targetCenter = curFrame.coords;
            targetBearing = curFrame.cam_bearing !== undefined ? curFrame.cam_bearing : curFrame.bearing;
        }

        const offsetY = Math.min(60, Math.round(window.innerHeight * 0.08));
        map.easeTo({
            center: targetCenter,
            pitch: 58,
            bearing: targetBearing,
            zoom: Math.max(16.2, map.getZoom()),
            offset: [0, offsetY],
            duration: 900
        });
        updateCamModeUI(true);
    } else if (mode === "fit") {
        // Encuadra toda la extensión de la ruta peatonal
        const rutaSource = map.getSource("ruta_src");
        if (rutaSource && rutaSource._data) {
            const coords = rutaSource._data.features[0].geometry.coordinates;
            const bounds = coords.reduce((b, coord) => b.extend(coord), new maplibregl.LngLatBounds(coords[0], coords[0]));
            map.fitBounds(bounds, { padding: 60, duration: 1000 });
        }
    }
}

/**
 * Alterna entre modo de cámara 3D (detrás del punto) y 2D (cenital Norte).
 */
function toggleCameraMode(force3D) {
    if (force3D !== undefined) {
        appState.animCameraMode = force3D ? "3d" : "2d";
    } else {
        appState.animCameraMode = appState.animCameraMode === "3d" ? "2d" : "3d";
    }

    if (appState.animCameraMode === "3d") {
        setCameraView("3d");
    } else {
        setCameraView("2d");
    }
}

/**
 * Actualiza la apariencia y texto del botón de modo de cámara (3D / 2D) en la barra de animación.
 */
function updateCamModeUI(is3D) {
    const btn = document.getElementById("btn-anim-cam-mode");
    const icon = document.getElementById("anim-cam-mode-icon");
    const text = document.getElementById("anim-cam-mode-text");

    if (btn) {
        if (is3D) {
            btn.classList.add("active");
            if (icon) icon.innerHTML = `<svg class="ui-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
            if (text) text.innerHTML = `<span class="btn-text-full">Cámara 3D (Detrás)</span><span class="btn-text-short">Cámara 3D</span>`;
        } else {
            btn.classList.remove("active");
            if (icon) icon.innerHTML = `<svg class="ui-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
            if (text) text.innerHTML = `<span class="btn-text-full">Vista 2D (Cenital)</span><span class="btn-text-short">Vista 2D</span>`;
        }
    }

    const btnCam2D = document.getElementById("btn-cam-2d");
    const btnCam3D = document.getElementById("btn-cam-3d");
    if (btnCam2D) btnCam2D.classList.toggle("active", !is3D);
    if (btnCam3D) btnCam3D.classList.toggle("active", is3D);
}

/**
 * Actualiza el ángulo visual de la flecha direccional del observador respecto a la rotación de la cámara.
 */
function updateObserverArrowDirection() {
    if (!appState.animData || !appState.animData.frames || !map) return;
    const frame = appState.animData.frames[appState.animCurrentFrame];
    if (!frame) return;

    const arrow = document.getElementById("observer-heading-arrow");
    if (arrow) {
        const curCamBearing = map.getBearing();
        const relHeading = ((frame.bearing - curCamBearing) + 360) % 360;
        arrow.style.transform = `rotate(${relHeading}deg)`;
    }
}


// ==============================================================================
// 6. POPUPS INTERACTIVOS Y EVENTOS DEL MOUSE
// ==============================================================================

/**
 * Configura los eventos de click y hover en las geometrías del mapa.
 */
function setupInteractivity() {
    // -------------------------------------------------------------------------
    // 1. Clic en Hitos / Puntos de Referencia y sus Etiquetas Nativas
    // -------------------------------------------------------------------------
    ["referencias-circles", "referencias-labels", "referencias-active-label"].forEach(layerId => {
        map.on("click", layerId, (e) => {
            if (appState.measure && appState.measure.active) return;
            if (!e.features || !e.features.length) return;
            const feat = e.features[0];
            const coords = feat.geometry.coordinates.slice();
            const props = feat.properties || {};
            showLandmarkPopup(coords, props.nombre || "Hito Urbano", props.fid || "");
        });

        map.on("mouseenter", layerId, () => {
            if (appState.measure && appState.measure.active) return;
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
            if (appState.measure && appState.measure.active) return;
            map.getCanvas().style.cursor = "";
        });
    });

    // -------------------------------------------------------------------------
    // 1.1 Clic en Punto de Inicio y Punto de Fin (Capas Nativas WebGL)
    // -------------------------------------------------------------------------
    [
        { layerId: "punto-inicio-circle", tipo: "Punto de Inicio", color: "#10b981" },
        { layerId: "punto-fin-circle", tipo: "Punto de Fin", color: "#ef4444" }
    ].forEach(({ layerId, tipo, color }) => {
        if (!map.getLayer(layerId)) return;

        map.on("click", layerId, (e) => {
            if (appState.measure && appState.measure.active) return;
            if (!e.features || !e.features.length) return;
            const feat = e.features[0];
            const coords = feat.geometry.coordinates.slice();
            const props = feat.properties || {};
            showTerminalPopup(coords, props.tipo || tipo, props.nombre || (tipo.includes("Inicio") ? "Inicio Recorrido" : "Fin Recorrido"), color);
        });

        map.on("mouseenter", layerId, () => {
            if (appState.measure && appState.measure.active) return;
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
            if (appState.measure && appState.measure.active) return;
            map.getCanvas().style.cursor = "";
        });
    });

    // -------------------------------------------------------------------------
    // 2. Eventos nativos de capas de edificios para cursor inmediato
    // -------------------------------------------------------------------------
    map.on("mouseenter", "edificios-3d", () => {
        if (appState.measure && appState.measure.active) return;
        map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "edificios-3d", () => {
        if (appState.measure && appState.measure.active) return;
        map.getCanvas().style.cursor = "";
    });
    map.on("mouseenter", "edificios-fill", () => {
        if (appState.measure && appState.measure.active) return;
        map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "edificios-fill", () => {
        if (appState.measure && appState.measure.active) return;
        map.getCanvas().style.cursor = "";
    });

    // -------------------------------------------------------------------------
    // 2. Clic interactivo en la Ruta (Vinculación cruzada con gráficas de perfil)
    // -------------------------------------------------------------------------
    ["ruta-line", "ruta-halo"].forEach(layerId => {
        if (!map.getLayer(layerId)) return;
        map.on("click", layerId, (e) => {
            if (appState.measure && appState.measure.active) return;
            handleRouteClick(e.lngLat);
        });
        map.on("mouseenter", layerId, () => {
            if (appState.measure && appState.measure.active) return;
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
            if (appState.measure && appState.measure.active) return;
            map.getCanvas().style.cursor = "";
        });
    });

    // -------------------------------------------------------------------------
    // 3. Selección infalible de edificios (Búfer de 8px + Tolerancia de arrastre)
    //    Evita clics perdidos en perspectiva 3D o por leve vibración del cursor
    // -------------------------------------------------------------------------
    let lastSelectionTimestamp = 0;

    function handleBuildingSelection(point, lngLat) {
        if (appState.measure && appState.measure.active) return;
        const now = Date.now();
        if (now - lastSelectionTimestamp < 180) return; // Prevenir disparos duplicados

        // Si se hizo clic sobre un hito, punto terminal, ruta o su etiqueta, esas capas ya lo atienden
        const checkTerminalLayers = ["referencias-circles", "referencias-labels", "referencias-active-label", "punto-inicio-circle", "punto-fin-circle", "ruta-line", "ruta-halo"]
            .filter(id => map.getLayer(id));
        const refHits = map.queryRenderedFeatures([
            [point.x - 8, point.y - 8],
            [point.x + 8, point.y + 8]
        ], { layers: checkTerminalLayers });
        if (refHits.length > 0) return;

        // Determinar capas activas de edificios
        const targetLayers = [];
        if (appState.buildings3DActive && map.getLayer("edificios-3d")) {
            targetLayers.push("edificios-3d");
        } else if (map.getLayer("edificios-fill") && map.getLayoutProperty("edificios-fill", "visibility") !== "none") {
            targetLayers.push("edificios-fill");
        }

        if (targetLayers.length === 0) return;

        // Búsqueda en caja delimitadora de 8px alrededor del punto
        const hits = map.queryRenderedFeatures([
            [point.x - 8, point.y - 8],
            [point.x + 8, point.y + 8]
        ], { layers: targetLayers });

        if (hits.length > 0) {
            lastSelectionTimestamp = now;
            showBuildingPopup(lngLat, hits[0].properties || {});
        }
    }

    // Clic estándar de MapLibre
    map.on("click", (e) => {
        if (appState.measure && appState.measure.active) {
            handleMeasureMapClick(e);
            return;
        }
        handleBuildingSelection(e.point, e.lngLat);
    });

    // Doble clic para finalizar medición
    map.on("dblclick", (e) => {
        if (appState.measure && appState.measure.active) {
            e.preventDefault();
            finishMeasurement();
        }
    });

    // Rastreo de gesto (mousedown -> mouseup):
    // Si el usuario presionó y soltó con un desplazamiento <= 8px y < 450ms,
    // se trata como clic intencional (supera la supresión de clic por paneo)
    let pointerDownPos = null;
    let pointerDownTime = 0;

    map.on("mousedown", (e) => {
        pointerDownPos = { x: e.point.x, y: e.point.y };
        pointerDownTime = Date.now();
    });

    map.on("mouseup", (e) => {
        if (appState.measure && appState.measure.active) return;
        if (!pointerDownPos) return;
        const dx = e.point.x - pointerDownPos.x;
        const dy = e.point.y - pointerDownPos.y;
        const dist = Math.hypot(dx, dy);
        const duration = Date.now() - pointerDownTime;

        if (dist <= 8 && duration < 450) {
            handleBuildingSelection(e.point, e.lngLat);
        }
        pointerDownPos = null;
    });

    // Cursor reactivo en movimiento con requestAnimationFrame para 60fps constantes
    let hoverPending = false;
    map.on("mousemove", (e) => {
        if (appState.measure && appState.measure.active) {
            handleMeasureMouseMove(e);
            return;
        }

        if (hoverPending) return;
        hoverPending = true;
        requestAnimationFrame(() => {
            hoverPending = false;
            if (!map || (appState.measure && appState.measure.active)) return;

            const checkLayers = [];
            if (map.getLayer("referencias-circles")) checkLayers.push("referencias-circles");
            if (map.getLayer("punto-inicio-circle")) checkLayers.push("punto-inicio-circle");
            if (map.getLayer("punto-fin-circle")) checkLayers.push("punto-fin-circle");
            if (appState.buildings3DActive && map.getLayer("edificios-3d")) {
                checkLayers.push("edificios-3d");
            } else if (map.getLayer("edificios-fill") && map.getLayoutProperty("edificios-fill", "visibility") !== "none") {
                checkLayers.push("edificios-fill");
            }

            if (checkLayers.length === 0) {
                map.getCanvas().style.cursor = "";
                return;
            }

            const hits = map.queryRenderedFeatures([
                [e.point.x - 6, e.point.y - 6],
                [e.point.x + 6, e.point.y + 6]
            ], { layers: checkLayers });

            if (hits.length > 0) {
                map.getCanvas().style.cursor = "pointer";
            } else {
                map.getCanvas().style.cursor = "";
            }
        });
    });
}

/**
 * Despliega un popup con la información del hito o punto de referencia.
 * Desactiva cualquier hito previamente activo antes de mostrar el nuevo.
 */
function showLandmarkPopup(coords, nombre, fid) {
    // 1. Desactivar el hito previo cerrando su popup activo
    if (appState.activePopup) {
        appState.activePopup.remove();
        appState.activePopup = null;
    }

    // 2. Actualizar ID del hito activo en el estado
    appState.activeLandmarkFid = fid;

    // 3. Resaltar en el mapa el hito activo (halo resplandeciente discreto)
    if (map && map.getLayer("referencias-active-glow")) {
        map.setFilter("referencias-active-glow", [
            "==",
            ["to-string", ["coalesce", ["get", "fid"], ""]],
            String(fid)
        ]);
    }
    // Al abrir el popup manualmente, NO se muestran etiquetas de texto flotantes,
    // ya que el popup desplegado ya contiene el nombre e información completa del hito.
    if (map && map.getLayer("referencias-active-label")) {
        map.setFilter("referencias-active-label", [
            "==",
            ["to-string", ["coalesce", ["get", "fid"], ""]],
            "__none__"
        ]);
    }
    if (map && map.getLayer("referencias-labels")) {
        map.setFilter("referencias-labels", [
            "!=",
            ["to-string", ["coalesce", ["get", "fid"], ""]],
            String(fid)
        ]);
    }

    // 4. Desactivar el hito anterior en la lista lateral y activar el nuevo
    document.querySelectorAll(".landmark-list-item").forEach(item => {
        if (String(item.dataset.fid) === String(fid)) {
            item.classList.add("active");
            item.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
            item.classList.remove("active");
        }
    });

    const html = `
        <div style="padding: 4px 6px;">
            <div style="font-size:10px; font-weight:700; color:#fbbf24; background:rgba(251,191,36,0.15); padding:2px 7px; border-radius:4px; display:inline-flex; align-items:center; gap:4px; margin-bottom:5px; text-transform:uppercase;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                Hito Urbano #${fid}
            </div>
            <div style="font-size:14px; font-weight:700; color:#f8fafc; line-height:1.3; margin-bottom:6px;">${nombre}</div>
            <div style="font-size:11px; color:#94a3b8; display:flex; flex-direction:column; gap:2px;">
                <span><strong>Latitud:</strong> ${coords[1].toFixed(6)}° N</span>
                <span><strong>Longitud:</strong> ${coords[0].toFixed(6)}° W</span>
            </div>
        </div>
    `;

    const popup = new maplibregl.Popup({ offset: 12, closeButton: true })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);

    appState.activePopup = popup;

    // Al cerrar el popup del hito activo, apagar el resalte
    popup.on("close", () => {
        if (appState.activeLandmarkFid === fid) {
            appState.activeLandmarkFid = null;
            appState.activePopup = null;
            if (map && map.getLayer("referencias-active-glow")) {
                map.setFilter("referencias-active-glow", ["==", ["to-string", ["coalesce", ["get", "fid"], ""]], "__none__"]);
            }
            if (map && map.getLayer("referencias-active-label")) {
                map.setFilter("referencias-active-label", ["==", ["to-string", ["coalesce", ["get", "fid"], ""]], "__none__"]);
            }
            if (map && map.getLayer("referencias-labels")) {
                map.setFilter("referencias-labels", null);
            }
            document.querySelectorAll(".landmark-list-item").forEach(item => {
                item.classList.remove("active");
            });
        }
    });
}

/**
 * Despliega un popup con los detalles del edificio (altura, niveles, fid).
 */
function showBuildingPopup(lngLat, props) {
    if (appState.activePopup) {
        appState.activePopup.remove();
        appState.activePopup = null;
    }

    const fid = props.fid || "S/N";
    const altura = props.altura !== undefined && props.altura !== null ? `${props.altura} m` : "Sin dato";
    const niveles = props.niveles || "1";
    const bloque = props.bloque || "A";

    const html = `
        <div style="padding: 4px 6px; min-width: 175px;">
            <div style="font-size:10px; font-weight:700; color:#38bdf8; background:rgba(56,189,248,0.15); padding:2px 7px; border-radius:4px; display:inline-flex; align-items:center; gap:4px; margin-bottom:5px; text-transform:uppercase;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="9" y1="22" x2="9" y2="2"/><line x1="15" y1="22" x2="15" y2="2"/><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
                Edificación #${fid}
            </div>
            <div style="font-size:16px; font-weight:800; color:#f8fafc; margin-bottom:6px;">
                ${altura} <span style="font-size:11.5px; font-weight:500; color:#94a3b8;">de altura</span>
            </div>
            <div style="font-size:11.5px; color:#cbd5e1; display:flex; flex-direction:column; gap:3px;">
                <span><strong>Niveles / Pisos:</strong> ${niveles}</span>
                <span><strong>Bloque:</strong> ${bloque}</span>
            </div>
        </div>
    `;

    const popup = new maplibregl.Popup({ offset: 10, closeButton: true })
        .setLngLat(lngLat)
        .setHTML(html)
        .addTo(map);

    appState.activePopup = popup;
}


// ==============================================================================
// 7. POPUPS DE PUNTOS TERMINALES (INICIO Y FIN) & ETIQUETAS NATIVAS
// ==============================================================================

/**
 * Despliega un popup informativo para el Punto de Inicio o Punto de Fin.
 * @param {[number, number]} coords - Coordenadas [lng, lat]
 * @param {string} tipo - "Punto de Inicio" o "Punto de Fin"
 * @param {string} nombre - Nombre del hito o terminal
 * @param {string} color - Color temático hex (#10b981 o #ef4444)
 */
function showTerminalPopup(coords, tipo, nombre, color) {
    if (appState.activePopup) {
        appState.activePopup.remove();
        appState.activePopup = null;
    }

    const isInicio = tipo.includes("Inicio");
    const iconSvg = isInicio
        ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`
        : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>`;

    const html = `
        <div style="padding: 4px 6px; min-width: 175px;">
            <div style="font-size:10px; font-weight:700; color:${color}; background:${color}20; border:1px solid ${color}40; padding:2px 7px; border-radius:4px; display:inline-flex; align-items:center; gap:5px; margin-bottom:5px; text-transform:uppercase;">
                ${iconSvg}
                ${tipo}
            </div>
            <div style="font-size:14px; font-weight:700; color:#f8fafc; line-height:1.3; margin-bottom:6px;">${nombre}</div>
            <div style="font-size:11px; color:#94a3b8; display:flex; flex-direction:column; gap:2px;">
                <span><strong>Latitud:</strong> ${coords[1].toFixed(6)}° N</span>
                <span><strong>Longitud:</strong> ${coords[0].toFixed(6)}° W</span>
            </div>
        </div>
    `;

    const popup = new maplibregl.Popup({ offset: 12, closeButton: true })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);

    appState.activePopup = popup;

    popup.on("close", () => {
        if (appState.activePopup === popup) {
            appState.activePopup = null;
        }
    });
}

/**
 * Alterna la visibilidad de todas las etiquetas nativas de hitos a la vez.
 * Renderizadas directamente en WebGL por MapLibre para 0 ms de retraso en paneo y animación.
 */
function toggleAllLandmarkNames() {
    appState.landmarksLabelsVisible = !appState.landmarksLabelsVisible;
    const btn = document.getElementById("btn-toggle-names");
    const chkRef = document.getElementById("chk-referencias");
    const isMasterVisible = !chkRef || chkRef.checked;
    const vis = (appState.landmarksLabelsVisible && isMasterVisible) ? "visible" : "none";

    if (map && map.getLayer("referencias-labels")) {
        map.setLayoutProperty("referencias-labels", "visibility", vis);
        if (appState.activeLandmarkFid && appState.activePopup) {
            map.setFilter("referencias-labels", [
                "!=",
                ["to-string", ["coalesce", ["get", "fid"], ""]],
                String(appState.activeLandmarkFid)
            ]);
        } else {
            map.setFilter("referencias-labels", null);
        }
    }

    if (btn) {
        const tagSvg = `<svg class="ui-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
        if (appState.landmarksLabelsVisible) {
            btn.classList.add("active");
            btn.innerHTML = `${tagSvg} Ocultar Nombres de Hitos`;
        } else {
            btn.classList.remove("active");
            btn.innerHTML = `${tagSvg} Mostrar Nombres de Hitos (Off)`;
        }
    }
}


// ==============================================================================
// 8. VINCULACIÓN CON LA INTERFAZ DE USUARIO (UI EVENT LISTENERS)
// ==============================================================================

/**
 * Vincula los checkboxes, botones y formularios de la interfaz gráfica.
 */
function setupUIEventListeners() {
    // 0. Selector de Mapa Base (Oscuro vs Satélite)
    const btnBmDark = document.getElementById("btn-bm-dark");
    if (btnBmDark) btnBmDark.addEventListener("click", () => setBasemap("dark"));

    const btnBmSat = document.getElementById("btn-bm-satellite");
    if (btnBmSat) btnBmSat.addEventListener("click", () => setBasemap("satellite"));

    // 1. Botones de Exageración (Relieve Real 1x, 2x, 3x / Edificios Real 1x, 2x, 3x)
    document.querySelectorAll(".btn-exag").forEach(btn => {
        btn.addEventListener("click", () => {
            const type = btn.dataset.type;
            const val = btn.dataset.val;
            if (type === "terrain") {
                setTerrainExaggeration(val);
            } else if (type === "buildings") {
                setBuildingsExaggeration(val);
            }
        });
    });

    // 2. Switches dentro del panel lateral
    const chkTerr = document.getElementById("chk-terreno-3d");
    if (chkTerr) chkTerr.addEventListener("change", (e) => toggleTerrain3D(e.target.checked));

    const chkEdif3d = document.getElementById("chk-edificios-3d");
    if (chkEdif3d) chkEdif3d.addEventListener("change", (e) => toggleBuildings3D(e.target.checked));

    // 3. Switch de Edificaciones (Master)
    const chkEdifMaster = document.getElementById("chk-edificios");
    if (chkEdifMaster) {
        chkEdifMaster.addEventListener("change", (e) => {
            appState.buildingsMasterVisible = e.target.checked;
            if (!appState.buildingsMasterVisible) {
                map.setLayoutProperty("edificios-fill", "visibility", "none");
                map.setLayoutProperty("edificios-3d", "visibility", "none");
            } else {
                if (appState.buildings3DActive) {
                    map.setLayoutProperty("edificios-3d", "visibility", "visible");
                } else {
                    map.setLayoutProperty("edificios-fill", "visibility", "visible");
                }
            }
        });
    }

    // 4. Switches de Capas 2D
    bindLayerToggle("chk-envolvente", ["envolvente-fill", "envolvente-line"]);
    bindLayerToggle("chk-ruta", ["ruta-line", "ruta-halo"]);

    // Switch individual de Punto de Inicio (capas nativas WebGL)
    const chkInicio = document.getElementById("chk-inicio");
    if (chkInicio) {
        chkInicio.addEventListener("change", (e) => {
            const isVisible = e.target.checked;
            const vis = isVisible ? "visible" : "none";
            if (map.getLayer("punto-inicio-circle")) map.setLayoutProperty("punto-inicio-circle", "visibility", vis);
            if (map.getLayer("punto-inicio-glow")) map.setLayoutProperty("punto-inicio-glow", "visibility", vis);
            if (!isVisible && appState.activePopup) {
                appState.activePopup.remove();
                appState.activePopup = null;
            }
        });
    }

    // Switch individual de Punto de Fin (capas nativas WebGL)
    const chkFin = document.getElementById("chk-fin");
    if (chkFin) {
        chkFin.addEventListener("change", (e) => {
            const isVisible = e.target.checked;
            const vis = isVisible ? "visible" : "none";
            if (map.getLayer("punto-fin-circle")) map.setLayoutProperty("punto-fin-circle", "visibility", vis);
            if (map.getLayer("punto-fin-glow")) map.setLayoutProperty("punto-fin-glow", "visibility", vis);
            if (!isVisible && appState.activePopup) {
                appState.activePopup.remove();
                appState.activePopup = null;
            }
        });
    }
    
    // Switch de Puntos de Referencia (círculos, halo y etiquetas nativas)
    const chkRef = document.getElementById("chk-referencias");
    if (chkRef) {
        chkRef.addEventListener("change", (e) => {
            const isChecked = e.target.checked;
            const vis = isChecked ? "visible" : "none";
            if (map.getLayer("referencias-glow")) {
                map.setLayoutProperty("referencias-glow", "visibility", vis);
            }
            if (map.getLayer("referencias-circles")) {
                map.setLayoutProperty("referencias-circles", "visibility", vis);
            }
            if (map.getLayer("referencias-active-glow")) {
                map.setLayoutProperty("referencias-active-glow", "visibility", vis);
            }
            if (map.getLayer("referencias-active-label")) {
                map.setLayoutProperty("referencias-active-label", "visibility", vis);
            }
            if (map.getLayer("referencias-labels")) {
                map.setLayoutProperty("referencias-labels", "visibility", (isChecked && appState.landmarksLabelsVisible) ? "visible" : "none");
            }
        });
    }

    // 5. Botones de perspectiva de cámara
    const btnCam2D = document.getElementById("btn-cam-2d");
    if (btnCam2D) btnCam2D.addEventListener("click", () => setCameraView("2d"));

    const btnCam3D = document.getElementById("btn-cam-3d");
    if (btnCam3D) btnCam3D.addEventListener("click", () => setCameraView("3d"));

    const btnCamFit = document.getElementById("btn-cam-fit");
    if (btnCamFit) btnCamFit.addEventListener("click", () => setCameraView("fit"));

    // 6. Botón de nombres de hitos
    const btnNames = document.getElementById("btn-toggle-names");
    if (btnNames) btnNames.addEventListener("click", toggleAllLandmarkNames);

    // 7. Botón para colapsar/expandir el panel lateral principal (Barra 1)
    const btnCollapse = document.getElementById("btn-toggle-panel");
    const mainPanel = document.getElementById("main-panel");
    if (btnCollapse && mainPanel) {
        // En dispositivos móviles (<= 768px) inicia colapsado para mantener el mapa despejado
        if (window.innerWidth <= 768) {
            mainPanel.classList.add("collapsed");
            btnCollapse.innerText = "+";
        }
        btnCollapse.addEventListener("click", () => {
            mainPanel.classList.toggle("collapsed");
            btnCollapse.innerText = mainPanel.classList.contains("collapsed") ? "+" : "−";
        });
    }

    // 7.1 Control Minimalista de Herramientas 3D y Medición (Minimizada por defecto)
    const btnToolsLauncher = document.getElementById("btn-tools-pill-launcher");
    const toolsPanel = document.getElementById("tools-panel");
    const btnCloseTools = document.getElementById("btn-close-tools");

    function toggleToolsPanel(forceState) {
        if (!toolsPanel) return;
        const shouldOpen = forceState !== undefined ? forceState : toolsPanel.classList.contains("hidden");
        if (shouldOpen) {
            toolsPanel.classList.remove("hidden");
            if (btnToolsLauncher) btnToolsLauncher.classList.add("active");
        } else {
            toolsPanel.classList.add("hidden");
            if (btnToolsLauncher) btnToolsLauncher.classList.remove("active");
        }
    }

    if (btnToolsLauncher) {
        btnToolsLauncher.addEventListener("click", () => toggleToolsPanel());
    }
    if (btnCloseTools) {
        btnCloseTools.addEventListener("click", () => toggleToolsPanel(false));
    }

    // Tecla Esc: Minimiza la barra de herramientas si está abierta y no hay medición activa
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && toolsPanel && !toolsPanel.classList.contains("hidden")) {
            if (!appState.measure || !appState.measure.active) {
                toggleToolsPanel(false);
            }
        }
    });

    // 8. Filtro en vivo del buscador de hitos
    const searchInput = document.getElementById("input-search-landmarks");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            const filtered = appState.landmarksData.filter(feat => {
                const nombre = (feat.properties.nombre || "").toLowerCase();
                const fid = String(feat.properties.fid || "");
                return nombre.includes(query) || fid.includes(query);
            });
            renderLandmarksList(filtered);
        });
    }

    // 9. Controles de Animación de Recorrido e Isovistas
    const btnAnimPlay = document.getElementById("btn-anim-play");
    if (btnAnimPlay) btnAnimPlay.addEventListener("click", togglePlayAnimation);

    const btnAnimStop = document.getElementById("btn-anim-stop");
    if (btnAnimStop) btnAnimStop.addEventListener("click", stopAnimation);

    const btnCamFollow = document.getElementById("btn-anim-cam-follow");
    if (btnCamFollow) btnCamFollow.addEventListener("click", () => toggleCameraFollow());

    const btnCamMode = document.getElementById("btn-anim-cam-mode");
    if (btnCamMode) btnCamMode.addEventListener("click", () => toggleCameraMode());

    // Botones de Velocidad (½x, 1x, 2x, 4x)
    document.querySelectorAll(".btn-speed").forEach(btn => {
        btn.addEventListener("click", () => {
            const spd = parseFloat(btn.dataset.speed);
            setAnimationSpeed(spd);
        });
    });

    // Control deslizante de línea de tiempo (Scrubber)
    const animSlider = document.getElementById("anim-slider");
    if (animSlider) {
        animSlider.addEventListener("input", (e) => {
            const fIndex = parseInt(e.target.value, 10);
            if (appState.animPlaying) pauseAnimation();
            renderAnimationFrame(fIndex, true);
        });
        animSlider.addEventListener("change", (e) => {
            const fIndex = parseInt(e.target.value, 10);
            renderAnimationFrame(fIndex, false);
        });
    }

    // Botón minimalista de Animación del Recorrido (en esquina inferior izquierda)
    const btnPillLauncher = document.getElementById("btn-anim-pill-launcher");
    if (btnPillLauncher) btnPillLauncher.addEventListener("click", () => toggleAnimationPlayer());

    const btnMinPlayer = document.getElementById("btn-anim-min");
    if (btnMinPlayer) btnMinPlayer.addEventListener("click", () => toggleAnimationPlayer(false));

    // Atajo de teclado: Barra espaciadora para Play / Pausa (si no se está escribiendo en el buscador)
    window.addEventListener("keydown", (e) => {
        if (e.code === "Space" && document.activeElement !== searchInput) {
            e.preventDefault();
            togglePlayAnimation();
        }
    });
}

/**
 * Función auxiliar para enlazar un checkbox con una o más capas del mapa.
 */
function bindLayerToggle(chkId, layerIds) {
    const chk = document.getElementById(chkId);
    if (!chk) return;
    chk.addEventListener("change", (e) => {
        const vis = e.target.checked ? "visible" : "none";
        layerIds.forEach(id => {
            if (map.getLayer(id)) {
                map.setLayoutProperty(id, "visibility", vis);
            }
        });
    });
}


// ==============================================================================
// 9. BUSCADOR Y LISTA INTERACTIVA DE HITOS URBANOS
// ==============================================================================

/**
 * Renderiza la lista de hitos en el contenedor del panel lateral.
 */
function renderLandmarksList(features) {
    const container = document.getElementById("landmarks-list");
    if (!container) return;

    container.innerHTML = "";

    if (features.length === 0) {
        container.innerHTML = `<div style="padding: 10px; font-size: 11px; color: #94a3b8; text-align: center;">No se encontraron hitos</div>`;
        return;
    }

    features.forEach(feat => {
        const props = feat.properties || {};
        const coords = feat.geometry.coordinates;
        const nombre = props.nombre || "Hito Urbano";
        const fid = props.fid || "";

        const item = document.createElement("div");
        item.className = "landmark-list-item";
        item.dataset.fid = fid;
        if (appState.activeLandmarkFid !== null && String(appState.activeLandmarkFid) === String(fid)) {
            item.classList.add("active");
        }
        item.innerHTML = `
            <span style="display:flex; align-items:center; gap:5px;"><svg class="ui-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> #${fid} ${nombre}</span>
            <span style="font-size: 10px; opacity: 0.6;">Ver</span>
        `;

        item.addEventListener("click", () => {
            // Volar suavemente hacia el hito y desplegar su popup
            map.flyTo({
                center: coords,
                zoom: 16.5,
                duration: 1200,
                essential: true
            });
            showLandmarkPopup(coords, nombre, fid);
        });

        container.appendChild(item);
    });
}

/**
 * Actualiza los valores de las tarjetas de métricas en la interfaz.
 */
function updateStatsUI(meta, edif) {
    const elRouteLen = document.getElementById("stat-route-len");
    const elBuildingCount = document.getElementById("stat-buildings-count");
    const elLandmarksCount = document.getElementById("stat-landmarks-count");

    if (elRouteLen) elRouteLen.innerText = `${(meta.longitud_ruta_metros / 1000).toFixed(1)} km`;
    if (elBuildingCount) elBuildingCount.innerText = `${edif.features.length.toLocaleString()} polígonos`;
    if (elLandmarksCount) elLandmarksCount.innerText = `${meta.total_hitos} hitos`;
}


// ==============================================================================
// 10. MOTOR DE ANIMACIÓN DE RECORRIDO E ISOVISTAS EN TIEMPO REAL
// ==============================================================================

/**
 * Prepara los fotogramas, precalcula las geometrías para 60fps y crea el marcador del observador.
 */
function setupAnimation() {
    if (!appState.animData || !appState.animData.frames || !appState.animData.frames.length) {
        console.warn("[Animación] No se encontraron datos de animación.");
        return;
    }

    const total = appState.animData.total_frames || appState.animData.frames.length;
    console.log(`[Animación] Configurando ${total} fotogramas a lo largo de ${appState.animData.longitud_total_m} m...`);

    // Precalcular rumbo suavizado de la cámara (filtro ponderado de 5 cuadros) para giros cinemáticos en esquinas de 90°
    for (let i = 0; i < total; i++) {
        let sinSum = 0, cosSum = 0, wSum = 0;
        for (let offset = -2; offset <= 2; offset++) {
            const idx = Math.max(0, Math.min(total - 1, i + offset));
            const w = 1.0 / (1.0 + Math.abs(offset));
            const rad = (appState.animData.frames[idx].bearing * Math.PI) / 180;
            sinSum += w * Math.sin(rad);
            cosSum += w * Math.cos(rad);
            wSum += w;
        }
        const avgRad = Math.atan2(sinSum, cosSum);
        const smoothDeg = ((avgRad * 180) / Math.PI + 360) % 360;
        appState.animData.frames[i].cam_bearing = Math.round(smoothDeg * 10) / 10;
    }

    // Precalcular array de features GeoJSON para actualización ultra-rápida (0 lag de GC)
    appState.prebuiltFeatures = appState.animData.frames.map((f, i) => ({
        type: "Feature",
        properties: {
            frame: f.frame,
            dist_m: f.dist_m,
            area_m2: f.area_m2,
            area_acum_ha: f.area_acum_ha
        },
        geometry: {
            type: "Polygon",
            coordinates: [f.isovista]
        }
    }));

    // Precalcular las ventanas de proximidad de cada hito para encendido y apagado dinámico al pasar
    computeLandmarkAnimationWindows();

    // Configurar el slider con los límites máximos
    const slider = document.getElementById("anim-slider");
    if (slider) {
        slider.min = "0";
        slider.max = String(total - 1);
        slider.value = "0";
    }

    const elEnd = document.getElementById("anim-time-end");
    if (elEnd) {
        elEnd.innerText = `${(appState.animData.longitud_total_m / 1000).toFixed(2)} km`;
    }

    // Crear el marcador del observador en la posición inicial (oculto por defecto al inicio)
    const firstFrame = appState.animData.frames[0];
    const elObs = document.createElement("div");
    elObs.className = "observer-marker-container";
    elObs.style.display = "none"; // Se hace visible solo al desplegar los controles
    elObs.innerHTML = `
        <div class="observer-pulse-ring"></div>
        <div class="observer-core-dot"></div>
        <div class="observer-heading-pointer" id="observer-heading-arrow"></div>
    `;

    appState.observerMarker = new maplibregl.Marker({
        element: elObs,
        anchor: "center"
    })
    .setLngLat(firstFrame.coords)
    .addTo(map);

    // Inicializar HUD de telemetría y controles (los polígonos de animación se despliegan al abrir)
    updateAnimationHUD(firstFrame, total);
    updateCamModeUI(false);
}

/**
 * Precalcula para cada fotograma de la animación los hitos por donde pasa el observador.
 * Ejecutado una sola vez al inicio para garantizar 0 ms de sobrecarga y 60+ FPS continuos.
 */
function computeLandmarkAnimationWindows() {
    if (!appState.animData || !appState.animData.frames || !appState.landmarksData || !appState.landmarksData.length) {
        return;
    }

    const frames = appState.animData.frames;
    const landmarks = appState.landmarksData;

    // 1. Calcular distancia mínima de cada hito a cualquier punto del recorrido
    const landmarkMinDists = {};
    landmarks.forEach(feat => {
        const fid = String(feat.properties.fid);
        const [lLng, lLat] = feat.geometry.coordinates;
        let minD = Infinity;

        for (let i = 0; i < frames.length; i++) {
            const [fLng, fLat] = frames[i].coords;
            const dLat = (fLat - lLat) * Math.PI / 180;
            const dLng = (fLng - lLng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(lLat * Math.PI / 180) * Math.cos(fLat * Math.PI / 180) *
                      Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const dist = 12742000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            if (dist < minD) minD = dist;
        }
        landmarkMinDists[fid] = minD;
    });

    // 2. Precalcular para cada fotograma el hito óptimo en tránsito (máximo 1 a la vez para evitar empalmes)
    const frameActiveFids = new Array(frames.length);

    for (let i = 0; i < frames.length; i++) {
        const [fLng, fLat] = frames[i].coords;
        const candidates = [];

        landmarks.forEach(feat => {
            const fid = String(feat.properties.fid);
            const [lLng, lLat] = feat.geometry.coordinates;
            const minD = landmarkMinDists[fid] || 25;
            // Umbral dinámico calibrado según la distancia del hito al eje de la calle
            const threshold = Math.min(Math.max(55.0, minD + 25.0), 105.0);

            const dLat = (fLat - lLat) * Math.PI / 180;
            const dLng = (fLng - lLng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(lLat * Math.PI / 180) * Math.cos(fLat * Math.PI / 180) *
                      Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const dist = 12742000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

            if (dist <= threshold) {
                // Puntuación de proximidad relativa a su punto más cercano en la ruta
                // Asegura alternancia perfecta y cero empalme cuando hay hitos próximos entre sí
                const relScore = dist - minD;
                candidates.push({ fid, relScore, dist });
            }
        });

        // Mantener encendidos simultáneamente todos los hitos del entorno en este fotograma
        // para que las etiquetas de hitos próximos permanezcan visibles sin encimarse
        if (candidates.length > 0) {
            candidates.sort((a, b) => a.relScore - b.relScore);
            frameActiveFids[i] = candidates.map(c => c.fid);
        } else {
            frameActiveFids[i] = [];
        }
    }

    appState.animLandmarkWindows = frameActiveFids;
}

/**
 * Enciende el halo y la etiqueta del hito por donde va pasando el observador en la animación,
 * y lo apaga inmediatamente una vez que lo pasa (con cero empalme entre etiquetas adyacentes).
 * @param {number} frameIndex - Índice del fotograma actual
 */
function syncAnimatedLandmarks(frameIndex) {
    if (!appState.animLandmarkWindows || !appState.animLandmarkWindows[frameIndex]) return;

    const currentActiveFids = appState.animLandmarkWindows[frameIndex];
    const prevActiveFids = appState.animActiveFids || [];

    // Comprobar si hubo cambio respecto al fotograma anterior para evitar llamadas innecesarias a setFilter
    const hasChanged = currentActiveFids.length !== prevActiveFids.length ||
        currentActiveFids.some((fid, idx) => fid !== prevActiveFids[idx]);

    if (!hasChanged) return;

    appState.animActiveFids = currentActiveFids.slice();

    // 1. Construir la expresión de filtro MapLibre (admite múltiples hitos activos simultáneos)
    let filterExpr;
    if (currentActiveFids.length === 0) {
        filterExpr = ["==", ["to-string", ["coalesce", ["get", "fid"], ""]], "__none__"];
    } else if (currentActiveFids.length === 1) {
        filterExpr = ["==", ["to-string", ["coalesce", ["get", "fid"], ""]], String(currentActiveFids[0])];
    } else {
        filterExpr = ["any", ...currentActiveFids.map(fid => ["==", ["to-string", ["coalesce", ["get", "fid"], ""]], String(fid)])];
    }

    // 2. Aplicar el filtro a las capas nativas de resalte en WebGL
    if (map && map.getLayer("referencias-active-glow")) {
        map.setFilter("referencias-active-glow", filterExpr);
    }
    if (map && map.getLayer("referencias-active-label")) {
        map.setFilter("referencias-active-label", filterExpr);
    }

    // 3. Sincronizar el estado visual en la lista lateral de hitos
    document.querySelectorAll(".landmark-list-item").forEach(item => {
        const itemFid = String(item.dataset.fid);
        if (currentActiveFids.includes(itemFid)) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });

    // 4. Si la animación está reproduciéndose y hay un hito activo, enfocarlo suavemente en la lista lateral
    if (appState.animPlaying && currentActiveFids.length > 0) {
        const activeElem = document.querySelector(`.landmark-list-item[data-fid="${currentActiveFids[0]}"]`);
        if (activeElem) {
            activeElem.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }
}

/**
 * Apaga el resalte de hitos animados (halo y etiqueta).
 */
function clearAnimatedLandmarks() {
    appState.animActiveFids = [];
    appState.activeLandmarkFid = null;
    const filterNone = ["==", ["to-string", ["coalesce", ["get", "fid"], ""]], "__none__"];
    if (map && map.getLayer("referencias-active-glow")) {
        map.setFilter("referencias-active-glow", filterNone);
    }
    if (map && map.getLayer("referencias-active-label")) {
        map.setFilter("referencias-active-label", filterNone);
    }
    document.querySelectorAll(".landmark-list-item").forEach(item => {
        item.classList.remove("active");
    });
}

/**
 * Renderiza el fotograma indicado: actualiza la isovista actual, el rastro acumulado,
 * la posición y orientación del observador, la telemetría HUD y la cámara.
 * En modo 3D, posiciona la cámara DETRÁS del observador mirando hacia el frente del avance.
 */
function renderAnimationFrame(frameIndex, isUserScrubbing = false) {
    if (!appState.animData || !appState.prebuiltFeatures.length) return;
    const total = appState.prebuiltFeatures.length;

    if (frameIndex < 0) frameIndex = 0;
    if (frameIndex >= total) frameIndex = total - 1;

    appState.animCurrentFrame = frameIndex;
    const frame = appState.animData.frames[frameIndex];

    // 1. Actualizar campo visual actual (isovista instantánea en cian brillante)
    if (map.getSource("anim_actual_src")) {
        map.getSource("anim_actual_src").setData(appState.prebuiltFeatures[frameIndex]);
    }

    // 2. Actualizar áreas de isovistas acumuladas (todas las descubiertas desde 0 hasta frameIndex)
    if (map.getSource("anim_acum_src")) {
        map.getSource("anim_acum_src").setData({
            type: "FeatureCollection",
            features: appState.prebuiltFeatures.slice(0, frameIndex + 1)
        });
    }

    // 3. Mover y rotar el marcador del observador
    if (appState.observerMarker) {
        appState.observerMarker.setLngLat(frame.coords);
        updateObserverArrowDirection();
    }

    // 4. Acompañar con la cámara si Seguir Cámara está activo
    if (appState.animCameraFollow && map) {
        const curPitch = map.getPitch();
        const curZoom = map.getZoom();
        // Modo 3D activo estrictamente según animCameraMode (evita que layers 3D bloqueen el modo 2D)
        const is3D = appState.animCameraMode === "3d";
        const dur = isUserScrubbing ? 0 : Math.max(80, Math.round(150 / appState.animSpeed));

        if (is3D) {
            // ==================================================================
            // MODO 3D: CÁMARA DETRÁS DEL OBSERVADOR (CHASE / PERSPECTIVA PEATONAL)
            // ==================================================================
            // 1. Inclinación 3D (pitch 58° ideal para cañón urbano y cielo)
            const targetPitch = 58;
            // 2. Zoom adecuado a vista de calle
            const targetZoom = curZoom < 15.2 ? 16.2 : curZoom;
            // 3. Orientación de cámara: rumbo de avance suavizado (cámara posicionada detrás)
            const targetBearing = frame.cam_bearing !== undefined ? frame.cam_bearing : frame.bearing;
            // 4. Desplazamiento sutil hacia abajo para mayor visión hacia adelante
            const offsetY = Math.min(60, Math.round(window.innerHeight * 0.08));

            if (isUserScrubbing) {
                map.jumpTo({
                    center: frame.coords,
                    pitch: targetPitch,
                    bearing: targetBearing,
                    zoom: targetZoom,
                    offset: [0, offsetY]
                });
            } else {
                map.easeTo({
                    center: frame.coords,
                    pitch: targetPitch,
                    bearing: targetBearing,
                    zoom: targetZoom,
                    offset: [0, offsetY],
                    duration: dur,
                    easing: (t) => t
                });
            }
        } else {
            // ==================================================================
            // MODO 2D: VISTA CENITAL ESTÁNDAR (NORTE ARRIBA, PITCH 0, BEARING 0)
            // ==================================================================
            const targetZoom = curZoom < 14.8 ? 15.6 : curZoom;
            if (isUserScrubbing) {
                map.jumpTo({
                    center: frame.coords,
                    pitch: 0,
                    bearing: 0,
                    zoom: targetZoom,
                    offset: [0, 0]
                });
            } else {
                map.easeTo({
                    center: frame.coords,
                    pitch: 0,
                    bearing: 0,
                    zoom: targetZoom,
                    offset: [0, 0],
                    duration: dur,
                    easing: (t) => t
                });
            }
        }
    }

    // 5. Encender dinámicamente el halo y la etiqueta de los hitos por donde va pasando el observador (y apagar los pasados)
    syncAnimatedLandmarks(frameIndex);

    // 6. Actualizar telemetría HUD y Scrubber Slider
    updateAnimationHUD(frame, total);

    // 7. Sincronizar la aguja del perfil de apertura visual
    updateProfileNeedle(frameIndex);
}

/**
 * Actualiza los chips de telemetría y el slider interactivo con los datos del fotograma.
 */
function updateAnimationHUD(frame, total) {
    const elDist = document.getElementById("anim-dist-val");
    if (elDist) elDist.innerText = `${(frame.dist_m / 1000).toFixed(2)} km`;

    const elPct = document.getElementById("anim-pct-val");
    if (elPct) elPct.innerText = `(${frame.pct.toFixed(0)}%)`;

    const elIso = document.getElementById("anim-iso-val");
    if (elIso) elIso.innerText = `${frame.area_m2.toLocaleString()} m²`;

    const elAcum = document.getElementById("anim-acum-val");
    if (elAcum) elAcum.innerText = `${frame.area_acum_ha.toFixed(2)} ha`;

    const elElev = document.getElementById("anim-elev-val");
    if (elElev && frame.elev_m !== undefined) {
        elElev.innerText = `${frame.elev_m.toFixed(1)} m`;
    }

    const elHito = document.getElementById("anim-hito-val");
    if (elHito) {
        const activeFids = appState.animActiveFids || [];
        if (activeFids.length > 0) {
            const activeNames = [];
            if (appState.landmarksData) {
                appState.landmarksData.forEach(f => {
                    if (activeFids.includes(String(f.properties.fid))) {
                        activeNames.push(f.properties.nombre);
                    }
                });
            }
            const labelText = activeNames.join(" • ") || (frame.hito ? frame.hito.nombre : "Hito");
            elHito.innerHTML = `<span style="color:#fbbf24; font-weight:700;">★ ${labelText}</span>`;
            elHito.title = `Hito en tránsito: ${labelText}`;
        } else if (frame.hito) {
            const hitoText = `${frame.hito.nombre} (a ${frame.hito.dist_m.toFixed(0)} m)`;
            elHito.innerText = hitoText;
            elHito.title = hitoText;
        } else {
            elHito.innerText = "Corredor Morelia";
            elHito.title = "Corredor Morelia Norte-Sur";
        }
    }

    const slider = document.getElementById("anim-slider");
    if (slider && parseInt(slider.value, 10) !== frame.frame) {
        slider.value = String(frame.frame);
    }
}

/**
 * Alterna entre reproducir y pausar la animación.
 */
function togglePlayAnimation() {
    if (appState.animPlaying) {
        pauseAnimation();
    } else {
        startAnimation();
    }
}

/**
 * Inicia el bucle de reproducción continua a lo largo de la ruta.
 */
function startAnimation() {
    if (appState.animPlaying || !appState.animData) return;
    appState.animPlaying = true;
    updatePlayButtonUI(true);

    hideProfileProbeFromMap();

    // Cerrar cualquier popup activo para que no quede rezagado al avanzar la cámara
    if (appState.activePopup) {
        appState.activePopup.remove();
        appState.activePopup = null;
    }

    const profTooltip = document.getElementById("profile-tooltip");
    if (profTooltip) profTooltip.classList.add("hidden");

    // Ocultar temporalmente la envolvente estática para disfrutar la revelación progresiva
    if (map.getLayer("envolvente-fill")) {
        map.setLayoutProperty("envolvente-fill", "visibility", "none");
        map.setLayoutProperty("envolvente-line", "visibility", "none");
    }

    // Si ya estábamos en el último fotograma, reiniciar automáticamente desde el principio
    if (appState.animCurrentFrame >= (appState.animData.total_frames - 1)) {
        appState.animCurrentFrame = 0;
        renderAnimationFrame(0, false);
    }

    const baseIntervalMs = 120; // ~8.3 fps a 1x -> ~28 segundos el recorrido completo

    function step() {
        if (!appState.animPlaying) return;

        const next = appState.animCurrentFrame + 1;
        if (next >= appState.animData.total_frames) {
            pauseAnimation();
            renderAnimationFrame(appState.animData.total_frames - 1, false);
            return;
        }

        renderAnimationFrame(next, false);
        const interval = Math.max(30, Math.round(baseIntervalMs / appState.animSpeed));
        appState.animTimer = setTimeout(step, interval);
    }

    const initialInterval = Math.max(30, Math.round(baseIntervalMs / appState.animSpeed));
    appState.animTimer = setTimeout(step, initialInterval);
}

/**
 * Pausa la animación manteniendo la posición actual.
 */
function pauseAnimation() {
    appState.animPlaying = false;
    if (appState.animTimer) {
        clearTimeout(appState.animTimer);
        appState.animTimer = null;
    }
    updatePlayButtonUI(false);
}

/**
 * Detiene la animación y regresa al punto de inicio (Norte).
 */
function stopAnimation() {
    pauseAnimation();
    renderAnimationFrame(0, false);

    // Restaurar visibilidad de la envolvente estática si su checkbox está activo
    const chkEnv = document.getElementById("chk-envolvente");
    if (chkEnv && chkEnv.checked && map.getLayer("envolvente-fill")) {
        map.setLayoutProperty("envolvente-fill", "visibility", "visible");
        map.setLayoutProperty("envolvente-line", "visibility", "visible");
    }
}

/**
 * Actualiza el texto e icono del botón principal de reproducción.
 */
function updatePlayButtonUI(isPlaying) {
    const btn = document.getElementById("btn-anim-play");
    const icon = document.getElementById("anim-play-icon");
    const text = document.getElementById("anim-play-text");

    if (btn) {
        if (isPlaying) {
            btn.classList.add("playing");
            if (icon) icon.innerHTML = `<svg class="ui-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
            if (text) text.innerText = "Pausar";
        } else {
            btn.classList.remove("playing");
            if (icon) icon.innerHTML = `<svg class="ui-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20 6 4"/></svg>`;
            if (text) {
                text.innerHTML = appState.animCurrentFrame > 0
                    ? "Continuar"
                    : `<span class="btn-text-full">Iniciar Recorrido</span><span class="btn-text-short">Iniciar</span>`;
            }
        }
    }
}

/**
 * Ajusta la velocidad de reproducción de la animación (½x, 1x, 2x, 4x).
 */
function setAnimationSpeed(speed) {
    appState.animSpeed = speed;

    document.querySelectorAll(".btn-speed").forEach(btn => {
        if (parseFloat(btn.dataset.speed) === speed) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

/**
 * Alterna el modo de seguimiento automático de la cámara sobre el observador.
 */
function toggleCameraFollow(forceState) {
    if (forceState !== undefined) {
        appState.animCameraFollow = forceState;
    } else {
        appState.animCameraFollow = !appState.animCameraFollow;
    }

    const btn = document.getElementById("btn-anim-cam-follow");
    if (btn) {
        const videoSvg = `<svg class="ui-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg>`;
        const stateStr = appState.animCameraFollow ? "On" : "Off";
        btn.classList.toggle("active", appState.animCameraFollow);
        btn.innerHTML = `${videoSvg} <span class="btn-text-full">Seguir Cámara (${stateStr})</span><span class="btn-text-short">Cámara (${stateStr})</span>`;
    }
}

/**
 * Muestra u oculta la barra flotante de animación en la pantalla y gestiona la visualización
 * del polígono de inicio y del marcador del observador.
 */
function toggleAnimationPlayer(forceState) {
    if (forceState !== undefined) {
        appState.animPlayerVisible = forceState;
    } else {
        appState.animPlayerVisible = !appState.animPlayerVisible;
    }

    const bar = document.getElementById("anim-player-bar");
    const pill = document.getElementById("btn-anim-pill-launcher");
    const ctrlGroup = document.getElementById("ctrl-anim-group");
    const btnSide = document.getElementById("btn-toggle-anim-player");
    const playSvg = `<svg class="ui-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

    if (appState.animPlayerVisible) {
        // 1. Mostrar barra de controles y activar botón en esquina inferior izquierda
        if (bar) bar.classList.remove("hidden");
        if (pill) pill.classList.add("active");
        if (ctrlGroup && window.innerWidth <= 768) {
            ctrlGroup.style.display = "none";
        }

        // 2. Mostrar el marcador del observador
        if (appState.observerMarker) {
            appState.observerMarker.getElement().style.display = "flex";
        }

        // 3. Al desplegar: hacer visible el polígono inicial del que comienza la animación
        renderAnimationFrame(appState.animCurrentFrame, false);

        // 4. Ocultar la envolvente estática para disfrutar la revelación progresiva
        if (map.getLayer("envolvente-fill")) {
            map.setLayoutProperty("envolvente-fill", "visibility", "none");
            map.setLayoutProperty("envolvente-line", "visibility", "none");
        }
    } else {
        // 1. Ocultar barra de controles y desactivar botón en esquina inferior izquierda
        if (bar) bar.classList.add("hidden");
        if (pill) pill.classList.remove("active");
        if (ctrlGroup) {
            ctrlGroup.style.display = "";
        }

        // 2. Si estaba reproduciéndose, pausar y apagar cualquier hito activo de la animación
        if (appState.animPlaying) {
            pauseAnimation();
        }
        clearAnimatedLandmarks();

        // 3. Ocultar el marcador del observador
        if (appState.observerMarker) {
            appState.observerMarker.getElement().style.display = "none";
        }

        // 4. Limpiar los polígonos de animación del mapa para restaurar la vista de mapa interactivo normal
        if (map.getSource("anim_actual_src")) {
            map.getSource("anim_actual_src").setData({ type: "FeatureCollection", features: [] });
        }
        if (map.getSource("anim_acum_src")) {
            map.getSource("anim_acum_src").setData({ type: "FeatureCollection", features: [] });
        }

        // 5. Restaurar la envolvente estática si su checkbox está seleccionado
        const chkEnv = document.getElementById("chk-envolvente");
        const envVis = (!chkEnv || chkEnv.checked) ? "visible" : "none";
        if (map.getLayer("envolvente-fill")) {
            map.setLayoutProperty("envolvente-fill", "visibility", envVis);
            map.setLayoutProperty("envolvente-line", "visibility", envVis);
        }
    }
}


// ==============================================================================
// 10. HERRAMIENTAS DE MEDICIÓN INTERACTIVA (DISTANCIA Y ÁREA)
// ==============================================================================

/**
 * Inicializa los escuchadores de eventos para las herramientas de medición.
 */
function setupMeasureTools() {
    // 1. Botones de activación en el panel lateral
    const btnDist = document.getElementById("btn-measure-distance");
    if (btnDist) {
        btnDist.addEventListener("click", () => setMeasureMode("distance"));
    }

    const btnArea = document.getElementById("btn-measure-area");
    if (btnArea) {
        btnArea.addEventListener("click", () => setMeasureMode("area"));
    }

    const btnClear = document.getElementById("btn-measure-clear");
    if (btnClear) {
        btnClear.addEventListener("click", () => clearMeasurement(true));
    }

    // 2. Botones de acción en el HUD flotante
    const btnHudClose = document.getElementById("btn-measure-hud-close");
    if (btnHudClose) {
        btnHudClose.addEventListener("click", () => clearMeasurement(true));
    }

    const btnHudReset = document.getElementById("btn-hud-reset");
    if (btnHudReset) {
        btnHudReset.addEventListener("click", () => clearMeasurement(false));
    }

    const btnHudUndo = document.getElementById("btn-hud-undo");
    if (btnHudUndo) {
        btnHudUndo.addEventListener("click", undoLastMeasurePoint);
    }

    const btnHudFinish = document.getElementById("btn-hud-finish");
    if (btnHudFinish) {
        btnHudFinish.addEventListener("click", finishMeasurement);
    }

    // 3. Atajos de teclado globales
    window.addEventListener("keydown", (e) => {
        if (!appState.measure || !appState.measure.active) return;

        if (e.key === "Escape") {
            e.preventDefault();
            clearMeasurement(true);
        } else if (e.key === "Enter") {
            e.preventDefault();
            finishMeasurement();
        } else if ((e.ctrlKey && (e.key === "z" || e.key === "Z")) || e.key === "Backspace") {
            // Evitar conflicto si el usuario está escribiendo en el buscador de hitos
            if (document.activeElement && document.activeElement.tagName === "INPUT") return;
            e.preventDefault();
            undoLastMeasurePoint();
        }
    });
}

/**
 * Activa, conmuta o desactiva el modo de medición ('distance' o 'area').
 * @param {'distance' | 'area' | null} mode
 */
function setMeasureMode(mode) {
    if (!map) return;

    // Si se presiona el botón del modo actualmente activo, se desactiva
    if (appState.measure.active && appState.measure.mode === mode) {
        clearMeasurement(true);
        return;
    }

    // Limpiar cualquier medición previa antes de iniciar el nuevo modo
    clearMeasurement(false);

    if (!mode) {
        clearMeasurement(true);
        return;
    }

    appState.measure.active = true;
    appState.measure.mode = mode;
    appState.measure.isFinished = false;

    // Desactivar el zoom con doble clic de MapLibre para permitir finalizar con doble clic
    map.doubleClickZoom.disable();

    // Cambiar cursor a cruz de precisión
    document.body.classList.add("measuring-active");
    map.getCanvas().style.cursor = "crosshair";

    // Actualizar botones del panel lateral
    const btnDist = document.getElementById("btn-measure-distance");
    const btnArea = document.getElementById("btn-measure-area");
    const btnClear = document.getElementById("btn-measure-clear");
    if (btnDist) btnDist.classList.toggle("active", mode === "distance");
    if (btnArea) btnArea.classList.toggle("active", mode === "area");
    if (btnClear) btnClear.removeAttribute("disabled");

    // Desplegar HUD superior y tarjeta del panel lateral
    const hud = document.getElementById("measure-hud");
    const hudIcon = document.getElementById("measure-hud-icon");
    const hudTitle = document.getElementById("measure-hud-title");
    const hudStatus = document.getElementById("measure-hud-status");
    const hudInst = document.getElementById("measure-hud-instruction");
    const hudLblPri = document.getElementById("measure-hud-lbl-primary");
    const hudValPri = document.getElementById("measure-hud-val-primary");
    const hudLblSec = document.getElementById("measure-hud-lbl-secondary");
    const hudValSec = document.getElementById("measure-hud-val-secondary");

    const panelCard = document.getElementById("panel-measure-card");
    const panelBadge = document.getElementById("panel-measure-badge");
    const panelStatus = document.getElementById("panel-measure-status");
    const panelPri = document.getElementById("panel-measure-primary");
    const panelSec = document.getElementById("panel-measure-secondary");

    if (hud) hud.classList.remove("hidden");
    if (panelCard) panelCard.classList.remove("hidden");

    if (mode === "distance") {
        if (hudIcon) hudIcon.innerHTML = `<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 8.7 8.7 21.3c-1 1-2.6 1-3.6 0l-2.4-2.4c-1-1-1-2.6 0-3.6L15.3 2.7c1-1 2.6-1 3.6 0l2.4 2.4c1 1 1 2.6 0 3.6Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/></svg>`;
        if (hudTitle) hudTitle.innerText = "Medición de Distancia";
        if (hudInst) hudInst.innerText = "Haz clic en el mapa para marcar el primer punto del trayecto";
        if (hudLblPri) hudLblPri.innerText = "Distancia Total";
        if (hudValPri) hudValPri.innerText = "0.0 m";
        if (hudLblSec) hudLblSec.innerText = "Tramos y Vértices";
        if (hudValSec) hudValSec.innerText = "0 puntos colocados";

        if (panelBadge) panelBadge.innerHTML = `<svg class="ui-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 8.7 8.7 21.3c-1 1-2.6 1-3.6 0l-2.4-2.4c-1-1-1-2.6 0-3.6L15.3 2.7c1-1 2.6-1 3.6 0l2.4 2.4c1 1 1 2.6 0 3.6Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/></svg> Distancia`;
        if (panelStatus) panelStatus.innerText = "En curso";
        if (panelPri) panelPri.innerText = "0.0 m";
        if (panelSec) panelSec.innerText = "0 puntos colocados";
    } else {
        if (hudIcon) hudIcon.innerHTML = `<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h4v4H3z"/><path d="M17 3h4v4h-4z"/><path d="M17 17h4v4h-4z"/><path d="M3 17h4v4H3z"/><path d="m5 7 0 10"/><path d="m7 5 10 0"/><path d="m19 7 0 10"/><path d="m7 19 10 0"/></svg>`;
        if (hudTitle) hudTitle.innerText = "Medición de Área Poligonal";
        if (hudInst) hudInst.innerText = "Haz clic en el mapa para trazar los vértices de la superficie";
        if (hudLblPri) hudLblPri.innerText = "Área Superficial";
        if (hudValPri) hudValPri.innerText = "0.0 m²";
        if (hudLblSec) hudLblSec.innerText = "Perímetro";
        if (hudValSec) hudValSec.innerText = "0.0 m (0 vértices)";

        if (panelBadge) panelBadge.innerHTML = `<svg class="ui-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h4v4H3z"/><path d="M17 3h4v4h-4z"/><path d="M17 17h4v4h-4z"/><path d="M3 17h4v4H3z"/><path d="m5 7 0 10"/><path d="m7 5 10 0"/><path d="m19 7 0 10"/><path d="m7 19 10 0"/></svg> Área`;
        if (panelStatus) panelStatus.innerText = "En curso";
        if (panelPri) panelPri.innerText = "0.0 m²";
        if (panelSec) panelSec.innerText = "0 vértices colocados";
    }

    if (hudStatus) hudStatus.innerText = "Activo";

    updateMeasureActionButtons();
}

/**
 * Atiende clics en el lienzo del mapa mientras la medición está activa.
 */
function handleMeasureMapClick(e) {
    if (!appState.measure.active) return;

    // Si ya estaba finalizada, un nuevo clic reinicia limpiamente un nuevo trazo
    if (appState.measure.isFinished) {
        clearMeasurement(false);
        appState.measure.active = true;
        appState.measure.isFinished = false;
        map.doubleClickZoom.disable();
    }

    const coord = [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))];
    const coords = appState.measure.coordinates;
    coords.push(coord);

    // Crear un marcador HTML numérico en el vértice
    const idx = coords.length;
    const markerEl = document.createElement("div");
    markerEl.className = "measure-node-marker";
    markerEl.innerText = String(idx);
    markerEl.title = `Vértice #${idx}`;

    const marker = new maplibregl.Marker({ element: markerEl, anchor: "center" })
        .setLngLat(coord)
        .addTo(map);

    appState.measure.markers.push(marker);

    // Actualizar geometrías en fuentes GeoJSON
    syncMeasureGeoJSON();

    // Actualizar cálculos y HUD
    recalculateMeasureMetrics();
    updateMeasureActionButtons();
}

/**
 * Rastrea el movimiento del cursor para dibujar la guía elástica (rubberband).
 */
let measureMouseMovePending = false;
function handleMeasureMouseMove(e) {
    if (!appState.measure.active || appState.measure.isFinished) return;
    const coords = appState.measure.coordinates;
    if (coords.length === 0) return;

    if (measureMouseMovePending) return;
    measureMouseMovePending = true;

    requestAnimationFrame(() => {
        measureMouseMovePending = false;
        if (!map || !appState.measure.active || appState.measure.isFinished) return;

        const cursorCoord = [e.lngLat.lng, e.lngLat.lat];
        const lastCoord = coords[coords.length - 1];

        // 1. Línea elástica (rubberband)
        const rbFeatures = [];
        if (appState.measure.mode === "distance") {
            rbFeatures.push({
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: [lastCoord, cursorCoord]
                }
            });
        } else if (appState.measure.mode === "area") {
            // En área, mostramos rubberband desde el último punto al cursor y del cursor al primero
            if (coords.length === 1) {
                rbFeatures.push({
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [lastCoord, cursorCoord]
                    }
                });
            } else {
                rbFeatures.push({
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [lastCoord, cursorCoord, coords[0]]
                    }
                });

                // Previsualización dinámica del polígono en vivo
                const previewPolygon = [...coords, cursorCoord, coords[0]];
                const polySrc = map.getSource("measure_polygon_src");
                if (polySrc) {
                    polySrc.setData({
                        type: "FeatureCollection",
                        features: [{
                            type: "Feature",
                            geometry: {
                                type: "Polygon",
                                coordinates: [previewPolygon]
                            }
                        }]
                    });
                }
            }
        }

        const rbSrc = map.getSource("measure_rubberband_src");
        if (rbSrc) {
            rbSrc.setData({
                type: "FeatureCollection",
                features: rbFeatures
            });
        }

        // 2. Previsualización de métrica en vivo con el cursor
        updateMeasureLivePreview(cursorCoord);
    });
}

/**
 * Calcula y actualiza los indicadores numéricos con la posición tentativa del cursor.
 */
function updateMeasureLivePreview(cursorCoord) {
    const coords = appState.measure.coordinates;
    if (coords.length === 0) return;

    const hudValPri = document.getElementById("measure-hud-val-primary");
    const lastCoord = coords[coords.length - 1];
    const segmentDist = calculateHaversineDistance(lastCoord, cursorCoord);

    if (appState.measure.mode === "distance") {
        const liveTotal = appState.measure.totalDistance + segmentDist;
        if (hudValPri) {
            hudValPri.innerHTML = `${formatDistance(liveTotal)} <span style="font-size:0.75em; opacity:0.75; font-weight:normal;">(+${formatDistance(segmentDist)})</span>`;
        }
    } else if (appState.measure.mode === "area") {
        if (coords.length >= 2) {
            const tempPoly = [...coords, cursorCoord];
            const liveArea = calculateSphericalPolygonArea(tempPoly);
            if (hudValPri) {
                hudValPri.innerText = formatArea(liveArea);
            }
        }
    }
}

/**
 * Finaliza el trazo de la medición actual, fija los valores y coloca una tarjeta flotante de resumen.
 */
function finishMeasurement() {
    if (!appState.measure.active || appState.measure.isFinished) return;
    const coords = appState.measure.coordinates;

    if (appState.measure.mode === "distance" && coords.length < 2) return;
    if (appState.measure.mode === "area" && coords.length < 3) return;

    appState.measure.isFinished = true;

    // Limpiar guía elástica (rubberband)
    const rbSrc = map.getSource("measure_rubberband_src");
    if (rbSrc) {
        rbSrc.setData({ type: "FeatureCollection", features: [] });
    }

    // Sincronizar geometrías definitivas
    syncMeasureGeoJSON();
    recalculateMeasureMetrics();

    // Eliminar marcador de total previo si existía
    if (appState.measure.totalMarker) {
        appState.measure.totalMarker.remove();
        appState.measure.totalMarker = null;
    }

    // Crear marcador flotante con insignia de resultado
    const totalEl = document.createElement("div");
    totalEl.className = "measure-total-badge";

    if (appState.measure.mode === "distance") {
        const lastCoord = coords[coords.length - 1];
        totalEl.innerHTML = `
            <div class="total-title"><svg class="ui-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 8.7 8.7 21.3c-1 1-2.6 1-3.6 0l-2.4-2.4c-1-1-1-2.6 0-3.6L15.3 2.7c1-1 2.6-1 3.6 0l2.4 2.4c1 1 1 2.6 0 3.6Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/></svg> Distancia Total</div>
            <div class="total-value">${formatDistance(appState.measure.totalDistance)}</div>
            <div class="total-sub">${coords.length} vértices • ${coords.length - 1} tramos</div>
        `;
        appState.measure.totalMarker = new maplibregl.Marker({ element: totalEl, anchor: "bottom", offset: [0, -12] })
            .setLngLat(lastCoord)
            .addTo(map);
    } else {
        // En área, calcular el centroide para ubicar la tarjeta
        let sumLng = 0, sumLat = 0;
        coords.forEach(pt => { sumLng += pt[0]; sumLat += pt[1]; });
        const centroid = [sumLng / coords.length, sumLat / coords.length];

        totalEl.innerHTML = `
            <div class="total-title"><svg class="ui-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h4v4H3z"/><path d="M17 3h4v4h-4z"/><path d="M17 17h4v4h-4z"/><path d="M3 17h4v4H3z"/><path d="m5 7 0 10"/><path d="m7 5 10 0"/><path d="m19 7 0 10"/><path d="m7 19 10 0"/></svg> Superficie Poligonal</div>
            <div class="total-value">${formatArea(appState.measure.totalArea)}</div>
            <div class="total-sub">Perímetro: ${formatDistance(appState.measure.totalDistance)}</div>
        `;
        appState.measure.totalMarker = new maplibregl.Marker({ element: totalEl, anchor: "center" })
            .setLngLat(centroid)
            .addTo(map);
    }

    // Actualizar textos UI
    const hudStatus = document.getElementById("measure-hud-status");
    const hudInst = document.getElementById("measure-hud-instruction");
    const panelStatus = document.getElementById("panel-measure-status");

    if (hudStatus) hudStatus.innerText = "Completado";
    if (panelStatus) panelStatus.innerText = "Completado";
    if (hudInst) hudInst.innerText = "Medición finalizada. Clic para trazar una nueva o 'Reiniciar' para borrar.";

    updateMeasureActionButtons();
}

/**
 * Deshace el último punto/vértice marcado.
 */
function undoLastMeasurePoint() {
    if (!appState.measure.active || appState.measure.coordinates.length === 0) return;

    if (appState.measure.isFinished) {
        appState.measure.isFinished = false;
        if (appState.measure.totalMarker) {
            appState.measure.totalMarker.remove();
            appState.measure.totalMarker = null;
        }
    }

    appState.measure.coordinates.pop();
    const marker = appState.measure.markers.pop();
    if (marker) marker.remove();

    syncMeasureGeoJSON();
    recalculateMeasureMetrics();
    updateMeasureActionButtons();
}

/**
 * Limpia todas las geometrías de medición y restaura el estado original.
 * @param {boolean} [andDeactivate=false] - Si es true, además apaga la herramienta y oculta el HUD
 */
function clearMeasurement(andDeactivate = false) {
    if (!appState.measure) return;

    // 1. Eliminar marcadores HTML
    appState.measure.markers.forEach(m => m.remove());
    appState.measure.markers = [];

    if (appState.measure.totalMarker) {
        appState.measure.totalMarker.remove();
        appState.measure.totalMarker = null;
    }

    // 2. Limpiar coordenadas y métricas
    appState.measure.coordinates = [];
    appState.measure.isFinished = false;
    appState.measure.totalDistance = 0;
    appState.measure.totalArea = 0;

    // 3. Limpiar capas GeoJSON
    ["measure_polygon_src", "measure_line_src", "measure_rubberband_src", "measure_points_src"].forEach(srcId => {
        if (map && map.getSource(srcId)) {
            map.getSource(srcId).setData({ type: "FeatureCollection", features: [] });
        }
    });

    // 4. Si se desactiva por completo:
    if (andDeactivate) {
        appState.measure.active = false;
        appState.measure.mode = null;

        if (map) {
            map.doubleClickZoom.enable();
            map.getCanvas().style.cursor = "";
        }
        document.body.classList.remove("measuring-active");

        const btnDist = document.getElementById("btn-measure-distance");
        const btnArea = document.getElementById("btn-measure-area");
        const btnClear = document.getElementById("btn-measure-clear");
        if (btnDist) btnDist.classList.remove("active");
        if (btnArea) btnArea.classList.remove("active");
        if (btnClear) btnClear.setAttribute("disabled", "true");

        const hud = document.getElementById("measure-hud");
        const panelCard = document.getElementById("panel-measure-card");
        if (hud) hud.classList.add("hidden");
        if (panelCard) panelCard.classList.add("hidden");
    } else {
        // Solo reiniciar contenido pero manteniendo el modo activo
        recalculateMeasureMetrics();
        updateMeasureActionButtons();
    }
}

/**
 * Sincroniza las fuentes GeoJSON de MapLibre con las coordenadas actuales.
 */
function syncMeasureGeoJSON() {
    if (!map) return;
    const coords = appState.measure.coordinates;

    // 1. Puntos de vértices
    const ptFeatures = coords.map((c, i) => ({
        type: "Feature",
        properties: { index: i + 1 },
        geometry: { type: "Point", coordinates: c }
    }));
    const ptSrc = map.getSource("measure_points_src");
    if (ptSrc) ptSrc.setData({ type: "FeatureCollection", features: ptFeatures });

    // 2. Línea sólida
    const lineSrc = map.getSource("measure_line_src");
    if (lineSrc) {
        if (coords.length >= 2) {
            // Si es área y está finalizado, cerrar la línea alrededor
            const lineCoords = (appState.measure.mode === "area" && appState.measure.isFinished)
                ? [...coords, coords[0]]
                : coords;

            lineSrc.setData({
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: lineCoords }
                }]
            });
        } else {
            lineSrc.setData({ type: "FeatureCollection", features: [] });
        }
    }

    // 3. Polígono de área
    const polySrc = map.getSource("measure_polygon_src");
    if (polySrc) {
        if (appState.measure.mode === "area" && coords.length >= 3) {
            const closed = [...coords, coords[0]];
            polySrc.setData({
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    geometry: { type: "Polygon", coordinates: [closed] }
                }]
            });
        } else {
            polySrc.setData({ type: "FeatureCollection", features: [] });
        }
    }
}

/**
 * Recalcula la distancia o área y actualiza los elementos de texto en pantalla.
 */
function recalculateMeasureMetrics() {
    const coords = appState.measure.coordinates;
    const mode = appState.measure.mode;

    let dist = 0;
    let area = 0;

    if (coords.length >= 2) {
        dist = calculateTotalPathDistance(coords);
        if (mode === "area" && coords.length >= 3) {
            // Sumar el tramo de cierre al perímetro
            dist += calculateHaversineDistance(coords[coords.length - 1], coords[0]);
            area = calculateSphericalPolygonArea(coords);
        }
    }

    appState.measure.totalDistance = dist;
    appState.measure.totalArea = area;

    // Elementos del HUD y Panel
    const hudValPri = document.getElementById("measure-hud-val-primary");
    const hudValSec = document.getElementById("measure-hud-val-secondary");
    const hudInst = document.getElementById("measure-hud-instruction");

    const panelPri = document.getElementById("panel-measure-primary");
    const panelSec = document.getElementById("panel-measure-secondary");

    if (mode === "distance") {
        const textDist = formatDistance(dist);
        const textSec = coords.length === 0
            ? "0 puntos colocados"
            : `${coords.length} puntos • ${Math.max(0, coords.length - 1)} tramos`;

        if (hudValPri) hudValPri.innerText = textDist;
        if (hudValSec) hudValSec.innerText = textSec;
        if (panelPri) panelPri.innerText = textDist;
        if (panelSec) panelSec.innerText = textSec;

        if (!appState.measure.isFinished && hudInst) {
            if (coords.length === 0) {
                hudInst.innerText = "Haz clic en el mapa para marcar el primer punto del trayecto";
            } else if (coords.length === 1) {
                hudInst.innerText = "Haz clic para añadir el siguiente tramo • Doble clic para finalizar";
            } else {
                hudInst.innerText = "Haz clic para añadir más tramos • Doble clic o Enter para finalizar";
            }
        }
    } else {
        const textArea = formatArea(area);
        const textPerim = `${formatDistance(dist)} (${coords.length} vértices)`;

        if (hudValPri) hudValPri.innerText = textArea;
        if (hudValSec) hudValSec.innerText = textPerim;
        if (panelPri) panelPri.innerText = textArea;
        if (panelSec) panelSec.innerText = textPerim;

        if (!appState.measure.isFinished && hudInst) {
            if (coords.length === 0) {
                hudInst.innerText = "Haz clic en el mapa para trazar el primer vértice del polígono";
            } else if (coords.length === 1) {
                hudInst.innerText = "Marca el segundo vértice de la superficie";
            } else if (coords.length === 2) {
                hudInst.innerText = "Marca un tercer vértice para cerrar el polígono y ver el área";
            } else {
                hudInst.innerText = "Haz clic para más vértices • Doble clic o Enter para finalizar";
            }
        }
    }
}

/**
 * Habilita o deshabilita los botones de Finalizar y Deshacer según la cantidad de vértices.
 */
function updateMeasureActionButtons() {
    const coords = appState.measure.coordinates;
    const mode = appState.measure.mode;
    const isFinished = appState.measure.isFinished;

    const btnUndo = document.getElementById("btn-hud-undo");
    const btnFinish = document.getElementById("btn-hud-finish");

    if (btnUndo) {
        btnUndo.disabled = (coords.length === 0);
    }

    if (btnFinish) {
        if (isFinished) {
            btnFinish.disabled = true;
        } else if (mode === "distance") {
            btnFinish.disabled = (coords.length < 2);
        } else if (mode === "area") {
            btnFinish.disabled = (coords.length < 3);
        }
    }
}

// ------------------------------------------------------------------------------
// Fórmulas Geodésicas de Alta Precisión (Haversine & Spherical Excess)
// ------------------------------------------------------------------------------

/**
 * Distancia ortodrómica Haversine entre dos puntos [lng, lat] en metros.
 * @param {[number, number]} p1 - Coordenadas [lng1, lat1]
 * @param {[number, number]} p2 - Coordenadas [lng2, lat2]
 * @returns {number} Distancia en metros
 */
function calculateHaversineDistance(p1, p2) {
    const R = 6371008.8; // Radio medio de la Tierra en metros (WGS-84)
    const toRad = Math.PI / 180;
    const lat1 = p1[1] * toRad;
    const lat2 = p2[1] * toRad;
    const deltaLat = (p2[1] - p1[1]) * toRad;
    const deltaLng = (p2[0] - p1[0]) * toRad;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Calcula la distancia acumulada de un arreglo de coordenadas [lng, lat].
 * @param {Array<[number, number]>} coords
 * @returns {number} Distancia total en metros
 */
function calculateTotalPathDistance(coords) {
    if (!coords || coords.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += calculateHaversineDistance(coords[i], coords[i + 1]);
    }
    return total;
}

/**
 * Calcula el área superficial geodésica de un polígono esférico en metros cuadrados (m²).
 * Emplea el método de exceso esférico de Girard / Gauss-Bonnet.
 * @param {Array<[number, number]>} coords - Anillo de coordenadas [lng, lat]
 * @returns {number} Área en metros cuadrados
 */
function calculateSphericalPolygonArea(coords) {
    if (!coords || coords.length < 3) return 0;
    const R = 6371008.8;
    const toRad = Math.PI / 180;
    let total = 0;
    const n = coords.length;

    for (let i = 0; i < n; i++) {
        const p1 = coords[i];
        const p2 = coords[(i + 1) % n];
        const lam1 = p1[0] * toRad;
        const lam2 = p2[0] * toRad;
        const phi1 = p1[1] * toRad;
        const phi2 = p2[1] * toRad;
        total += (lam2 - lam1) * (2 + Math.sin(phi1) + Math.sin(phi2));
    }

    return Math.abs((total * R * R) / 2.0);
}

/**
 * Formatea una distancia en metros a texto legible (m o km).
 * @param {number} meters
 * @returns {string}
 */
function formatDistance(meters) {
    if (!meters || meters <= 0) return "0.0 m";
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters.toFixed(1)} m`;
}

/**
 * Formatea un área en m² a texto legible (m², ha o km²).
 * @param {number} sqMeters
 * @returns {string}
 */
function formatArea(sqMeters) {
    if (!sqMeters || sqMeters <= 0) return "0.0 m²";
    if (sqMeters >= 1000000) {
        return `${(sqMeters / 1000000).toFixed(2)} km²`;
    }
    if (sqMeters >= 10000) {
        const ha = (sqMeters / 10000).toFixed(2);
        return `${ha} ha (${Math.round(sqMeters).toLocaleString()} m²)`;
    }
    return `${sqMeters.toFixed(1)} m²`;
}


// ==============================================================================
// 11. CONTROL DEL OVERLAY DE CARGA
// ==============================================================================

function updateLoadingText(title, subtext) {
    const elTitle = document.querySelector("#loading-overlay .loading-text");
    const elSub = document.querySelector("#loading-overlay .loading-subtext");
    if (elTitle) elTitle.innerText = title;
    if (elSub) elSub.innerText = subtext;
}

function hideLoadingOverlay() {
    const overlay = document.getElementById("loading-overlay");
    if (overlay) {
        setTimeout(() => {
            overlay.classList.add("hidden");
        }, 300);
    }
}


// ==============================================================================
// 13. MEJORAS AVANZADAS: PERFIL VISUAL, CAPTURA HD Y LUZ SOLAR 3D
// ==============================================================================

/**
 * Inicializa las mejoras avanzadas: exportación de capturas, perfil de isovistas y luz solar.
 */
function setupAdvancedFeatures() {
    // 1. Botones de captura de pantalla HD
    const btnSnapshotHdr = document.getElementById("btn-header-snapshot");
    if (btnSnapshotHdr) btnSnapshotHdr.addEventListener("click", exportMapScreenshot);

    const btnSnapshotUtil = document.getElementById("btn-export-screenshot");
    if (btnSnapshotUtil) btnSnapshotUtil.addEventListener("click", exportMapScreenshot);

    // 2. Control del Drawer del Perfil de Isovistas
    const btnToggleProfPanel = document.getElementById("btn-toggle-profile-panel");
    if (btnToggleProfPanel) btnToggleProfPanel.addEventListener("click", () => toggleProfileDrawer());

    const btnCloseProf = document.getElementById("btn-close-profile");
    if (btnCloseProf) btnCloseProf.addEventListener("click", () => toggleProfileDrawer(false));

    // 3. Selector de Pestañas de Perfil (Ambas, Isovistas, Altitud)
    const tabBoth = document.getElementById("tab-prof-both");
    const tabIso = document.getElementById("tab-prof-iso");
    const tabElev = document.getElementById("tab-prof-elev");
    if (tabBoth) tabBoth.addEventListener("click", () => setProfileTab("both"));
    if (tabIso) tabIso.addEventListener("click", () => setProfileTab("iso"));
    if (tabElev) tabElev.addEventListener("click", () => setProfileTab("elev"));

    // 6. Configurar los gráficos duales una vez cargados los datos de animación
    if (appState.animData && appState.animData.frames) {
        buildDualProfileCharts();
    }
}

/**
 * Alterna la visibilidad del Drawer inferior de los perfiles de análisis (Isovistas y Altitud).
 * @param {boolean} [forceState]
 */
function toggleProfileDrawer(forceState) {
    const drawer = document.getElementById("profile-chart-drawer");
    if (!drawer) return;

    const isCollapsed = drawer.classList.contains("collapsed");
    const open = forceState !== undefined ? forceState : isCollapsed;

    if (open) {
        drawer.classList.remove("collapsed");
        buildDualProfileCharts();
        updateProfileNeedle(appState.animCurrentFrame);
    } else {
        drawer.classList.add("collapsed");
        const tooltip = document.getElementById("profile-tooltip");
        if (tooltip) tooltip.classList.add("hidden");
        hideProfileProbeFromMap();
    }
}

/**
 * Conmuta entre las vistas de los perfiles: 'both' (ambas), 'iso' (sólo isovistas), 'elev' (sólo altitud).
 * @param {'both' | 'iso' | 'elev'} tab
 */
function setProfileTab(tab) {
    const tabBoth = document.getElementById("tab-prof-both");
    const tabIso = document.getElementById("tab-prof-iso");
    const tabElev = document.getElementById("tab-prof-elev");
    const blockIso = document.getElementById("block-profile-iso");
    const blockElev = document.getElementById("block-profile-elev");

    if (tabBoth) tabBoth.classList.toggle("active", tab === "both");
    if (tabIso) tabIso.classList.toggle("active", tab === "iso");
    if (tabElev) tabElev.classList.toggle("active", tab === "elev");

    if (blockIso) {
        if (tab === "both" || tab === "iso") {
            blockIso.classList.remove("hidden-block");
        } else {
            blockIso.classList.add("hidden-block");
        }
    }

    if (blockElev) {
        if (tab === "both" || tab === "elev") {
            blockElev.classList.remove("hidden-block");
        } else {
            blockElev.classList.add("hidden-block");
        }
    }
}

/**
 * Construye los dos gráficos SVG sincronizados:
 * 1. Perfil de Apertura Visual (m² de isovistas) en cian brillante.
 * 2. Perfil Altitudinal del Terreno (msnm topográfico) en esmeralda vivo.
 */
function buildDualProfileCharts() {
    if (!appState.animData || !appState.animData.frames) return;
    const frames = appState.animData.frames;
    const total = frames.length;
    if (total === 0) return;

    // ---------------------------------------------------------
    // 1. Estadísticas y Curva de Isovistas (Área Visual m²)
    // ---------------------------------------------------------
    let maxArea = 0;
    let minArea = Infinity;
    let sumArea = 0;

    frames.forEach(f => {
        if (f.area_m2 > maxArea) maxArea = f.area_m2;
        if (f.area_m2 < minArea) minArea = f.area_m2;
        sumArea += f.area_m2;
    });
    const avgArea = Math.round(sumArea / total);

    const elMax = document.getElementById("profile-stat-max");
    const elAvg = document.getElementById("profile-stat-avg");
    const elMin = document.getElementById("profile-stat-min");
    if (elMax) elMax.innerText = `${maxArea.toLocaleString()} m²`;
    if (elAvg) elAvg.innerText = `${avgArea.toLocaleString()} m²`;
    if (elMin) elMin.innerText = `${minArea.toLocaleString()} m²`;

    const svgW = 1000;
    const svgH = 80;
    const padTop = 14;
    const padBottom = 8;
    const chartH = svgH - padTop - padBottom;

    const points = frames.map((f, i) => {
        const x = Number(((i / (total - 1)) * svgW).toFixed(1));
        const norm = maxArea > 0 ? f.area_m2 / maxArea : 0;
        const y = Number((padTop + (1 - norm) * chartH).toFixed(1));
        return { x, y, frame: f, index: i };
    });

    let pathD = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
        pathD += ` L ${points[i].x},${points[i].y}`;
    }
    const areaD = `${pathD} L ${svgW},${svgH} L 0,${svgH} Z`;

    let landmarkCirclesIso = "";
    points.forEach(p => {
        if (p.frame.hito && p.frame.hito.dist_m < 35) {
            landmarkCirclesIso += `
                <circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#fbbf24" stroke="#0f172a" stroke-width="1.5">
                    <title>${p.frame.hito.nombre} (${p.frame.area_m2.toLocaleString()} m²)</title>
                </circle>
            `;
        }
    });

    const svgIso = document.getElementById("profile-svg-iso");
    if (svgIso) {
        svgIso.innerHTML = `
            <defs>
                <linearGradient id="profile-area-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.45" />
                    <stop offset="50%" stop-color="#0284c7" stop-opacity="0.18" />
                    <stop offset="100%" stop-color="#0f172a" stop-opacity="0.0" />
                </linearGradient>
                <linearGradient id="profile-stroke-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="#38bdf8" />
                    <stop offset="50%" stop-color="#67e8f9" />
                    <stop offset="100%" stop-color="#38bdf8" />
                </linearGradient>
            </defs>
            <path d="${areaD}" fill="url(#profile-area-grad)" />
            <path d="${pathD}" fill="none" stroke="url(#profile-stroke-grad)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
            ${landmarkCirclesIso}
        `;
    }

    // ---------------------------------------------------------
    // 2. Estadísticas y Curva de Altitud Topográfica (DEM msnm)
    // ---------------------------------------------------------
    let maxElev = -Infinity;
    let minElev = Infinity;

    frames.forEach(f => {
        const e = f.elev_m !== undefined ? f.elev_m : 1900;
        if (e > maxElev) maxElev = e;
        if (e < minElev) minElev = e;
    });

    const elevDiff = (maxElev - minElev).toFixed(1);
    const elElevMax = document.getElementById("elev-stat-max");
    const elElevMin = document.getElementById("elev-stat-min");
    const elElevDiff = document.getElementById("elev-stat-diff");
    if (elElevMax) elElevMax.innerText = `${maxElev.toFixed(1)} m`;
    if (elElevMin) elElevMin.innerText = `${minElev.toFixed(1)} m`;
    if (elElevDiff) elElevDiff.innerText = `+${elevDiff} m`;

    const elevSpan = Math.max(5, maxElev - minElev);
    const elevPad = elevSpan * 0.08;
    const elevFloor = minElev - elevPad;
    const elevCeil = maxElev + elevPad;
    const elevTotalRange = elevCeil - elevFloor;

    const pointsElev = frames.map((f, i) => {
        const x = Number(((i / (total - 1)) * svgW).toFixed(1));
        const e = f.elev_m !== undefined ? f.elev_m : minElev;
        const norm = (e - elevFloor) / elevTotalRange;
        const y = Number((padTop + (1 - norm) * chartH).toFixed(1));
        return { x, y, frame: f, index: i };
    });

    let pathElevD = `M ${pointsElev[0].x},${pointsElev[0].y}`;
    for (let i = 1; i < pointsElev.length; i++) {
        pathElevD += ` L ${pointsElev[i].x},${pointsElev[i].y}`;
    }
    const areaElevD = `${pathElevD} L ${svgW},${svgH} L 0,${svgH} Z`;

    let landmarkCirclesElev = "";
    pointsElev.forEach(p => {
        if (p.frame.hito && p.frame.hito.dist_m < 35) {
            landmarkCirclesElev += `
                <circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#fbbf24" stroke="#0f172a" stroke-width="1.5">
                    <title>${p.frame.hito.nombre} (${p.frame.elev_m !== undefined ? p.frame.elev_m.toFixed(1) : ''} msnm)</title>
                </circle>
            `;
        }
    });

    const svgElev = document.getElementById("profile-svg-elev");
    if (svgElev) {
        svgElev.innerHTML = `
            <defs>
                <linearGradient id="elev-area-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#10b981" stop-opacity="0.45" />
                    <stop offset="50%" stop-color="#059669" stop-opacity="0.20" />
                    <stop offset="100%" stop-color="#064e3b" stop-opacity="0.0" />
                </linearGradient>
                <linearGradient id="elev-stroke-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="#34d399" />
                    <stop offset="50%" stop-color="#10b981" />
                    <stop offset="100%" stop-color="#6ee7b7" />
                </linearGradient>
            </defs>
            <path d="${areaElevD}" fill="url(#elev-area-grad)" />
            <path d="${pathElevD}" fill="none" stroke="url(#elev-stroke-grad)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
            ${landmarkCirclesElev}
        `;
    }

    // ---------------------------------------------------------
    // 3. Interacción cruzada sincronizada en ambos gráficos
    // ---------------------------------------------------------
    setupDualProfileInteractivity(points, total);
}

// Compatibilidad retroactiva
const buildVisualOpennessChart = buildDualProfileCharts;

/**
 * Crea o actualiza en el mapa el marcador que señala el punto exacto donde se toma el dato.
 * Despliega un halo pulsante y una insignia flotante con distancia y cota.
 * @param {object} p - Objeto con { frame, index }
 */
function showProfileProbeOnMap(p) {
    if (!map || !p || !p.frame) return;

    const coords = p.frame.coords;
    const distKm = (p.frame.dist_m / 1000).toFixed(2);
    const elevM = p.frame.elev_m !== undefined ? p.frame.elev_m.toFixed(1) : "--";

    if (!appState.profileProbeMarker) {
        const el = document.createElement("div");
        el.className = "probe-marker-container";
        el.innerHTML = `
            <div class="probe-pulse-ring"></div>
            <div class="probe-core-dot"></div>
            <div class="probe-badge-pill" id="probe-badge-pill">
                <span class="probe-badge-dist" id="probe-badge-dist">${distKm} km</span>
                <span class="probe-badge-sep">•</span>
                <span class="probe-badge-elev" id="probe-badge-elev">${elevM} m</span>
            </div>
        `;

        appState.profileProbeMarker = new maplibregl.Marker({
            element: el,
            anchor: "center"
        })
        .setLngLat(coords)
        .addTo(map);
    } else {
        appState.profileProbeMarker.setLngLat(coords);
        const elDist = document.getElementById("probe-badge-dist");
        const elElev = document.getElementById("probe-badge-elev");
        if (elDist) elDist.innerText = `${distKm} km`;
        if (elElev) elElev.innerText = `${elevM} m`;
    }

    const markerEl = appState.profileProbeMarker.getElement();
    if (markerEl) {
        markerEl.style.display = "flex";
    }

    // Centrar suavemente en el punto de muestreo si está fuera o en los bordes del mapa
    const drawer = document.getElementById("profile-chart-drawer");
    const isDrawerOpen = drawer && !drawer.classList.contains("collapsed");
    const offsetY = isDrawerOpen ? -Math.round(window.innerHeight * 0.12) : 0;

    const canvas = map.getCanvas();
    const dpr = window.devicePixelRatio || 1;
    const pointPos = map.project(coords);
    const margin = 60;
    const bottomCutoff = (canvas.height / dpr) - (isDrawerOpen ? 240 : margin);
    const isOutside = pointPos.x < margin || pointPos.x > ((canvas.width / dpr) - margin) ||
                      pointPos.y < margin || pointPos.y > bottomCutoff;

    if (isOutside) {
        map.easeTo({
            center: coords,
            offset: [0, offsetY],
            duration: 350,
            easing: (t) => t
        });
    }
}

/**
 * Oculta el marcador del punto de muestreo en el mapa.
 */
function hideProfileProbeFromMap() {
    if (appState.profileProbeMarker) {
        const markerEl = appState.profileProbeMarker.getElement();
        if (markerEl) {
            markerEl.style.display = "none";
        }
    }
}

/**
 * Permite seleccionar el punto de muestreo haciendo clic directamente sobre la ruta en el mapa.
 * Sincroniza la gráfica, el tooltip y el marcador de muestreo.
 * @param {[number, number] | { lng: number, lat: number }} lngLat
 */
function handleRouteClick(lngLat) {
    if (!appState.animData || !appState.animData.frames || !appState.animData.frames.length) return;

    const clickLng = lngLat.lng !== undefined ? lngLat.lng : lngLat[0];
    const clickLat = lngLat.lat !== undefined ? lngLat.lat : lngLat[1];
    const frames = appState.animData.frames;

    // Encontrar el frame más cercano a las coordenadas del clic
    let closestIndex = 0;
    let minDistanceSq = Infinity;

    for (let i = 0; i < frames.length; i++) {
        const [fLng, fLat] = frames[i].coords;
        const dx = (fLng - clickLng) * Math.cos((clickLat * Math.PI) / 180);
        const dy = fLat - clickLat;
        const dSq = dx * dx + dy * dy;
        if (dSq < minDistanceSq) {
            minDistanceSq = dSq;
            closestIndex = i;
        }
    }

    const frame = frames[closestIndex];
    const p = { frame, index: closestIndex };

    // Mostrar el punto de muestreo en el mapa
    showProfileProbeOnMap(p);

    // Actualizar aguja en las gráficas
    updateProfileNeedle(closestIndex);

    // Actualizar campo visual e isovista en el mapa
    renderAnimationFrame(closestIndex, false);

    // Si el drawer de perfiles está abierto, sincronizar el tooltip flotante de la gráfica
    const tooltip = document.getElementById("profile-tooltip");
    const container = document.getElementById("profile-chart-container-iso") || document.getElementById("profile-chart-container-elev");
    if (tooltip && container) {
        const rect = container.getBoundingClientRect();
        const fraction = closestIndex / (frames.length - 1);
        const relX = fraction * rect.width;

        tooltip.classList.remove("hidden");
        tooltip.style.left = `${relX}px`;

        const ptDist = document.getElementById("pt-dist");
        const ptArea = document.getElementById("pt-area");
        const ptElev = document.getElementById("pt-elev");
        const ptHito = document.getElementById("pt-hito");

        if (ptDist) ptDist.innerText = `${(frame.dist_m / 1000).toFixed(2)} km (${frame.pct.toFixed(0)}%)`;
        if (ptArea) ptArea.innerHTML = `<svg class="ui-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ${frame.area_m2.toLocaleString()} m²`;
        if (ptElev) ptElev.innerHTML = `<svg class="ui-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg> ${frame.elev_m !== undefined ? frame.elev_m.toFixed(1) : '--'} msnm`;
        if (ptHito) {
            ptHito.innerHTML = frame.hito ? `<svg class="ui-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${frame.hito.nombre}` : "";
        }
    }
}

/**
 * Configura la interactividad unificada sobre ambos contenedores de perfiles.
 * El tooltip/popup se muestra ÚNICAMENTE cuando el usuario hace clic o arrastra sobre las gráficas.
 */
function setupDualProfileInteractivity(points, total) {
    const containers = [
        document.getElementById("profile-chart-container-iso"),
        document.getElementById("profile-chart-container-elev")
    ].filter(Boolean);

    const tooltip = document.getElementById("profile-tooltip");
    const ptDist = document.getElementById("pt-dist");
    const ptArea = document.getElementById("pt-area");
    const ptElev = document.getElementById("pt-elev");
    const ptHito = document.getElementById("pt-hito");
    const btnClose = document.getElementById("pt-close-btn");

    if (btnClose && !btnClose._hasListener) {
        btnClose._hasListener = true;
        btnClose.addEventListener("click", (e) => {
            e.stopPropagation();
            if (tooltip) tooltip.classList.add("hidden");
            hideProfileProbeFromMap();
        });
    }

    function updateTooltipAndJump(container, e, jumpMap = true) {
        const rect = container.getBoundingClientRect();
        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : rect.left);
        const relX = Math.max(0, Math.min(rect.width, clientX - rect.left));
        const fraction = relX / rect.width;
        const targetIndex = Math.min(total - 1, Math.max(0, Math.round(fraction * (total - 1))));
        const p = points[targetIndex];

        if (tooltip) {
            tooltip.classList.remove("hidden");
            tooltip.style.left = `${relX}px`;
            if (ptDist) ptDist.innerText = `${(p.frame.dist_m / 1000).toFixed(2)} km (${p.frame.pct.toFixed(0)}%)`;
            if (ptArea) ptArea.innerHTML = `<svg class="ui-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ${p.frame.area_m2.toLocaleString()} m²`;
            if (ptElev) ptElev.innerHTML = `<svg class="ui-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg> ${p.frame.elev_m !== undefined ? p.frame.elev_m.toFixed(1) : '--'} msnm`;
            if (ptHito) {
                ptHito.innerHTML = p.frame.hito ? `<svg class="ui-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${p.frame.hito.nombre}` : "";
            }
        }

        // Mostrar el punto de muestreo exacto en el mapa
        showProfileProbeOnMap(p);

        if (jumpMap) {
            if (appState.animPlaying) pauseAnimation();
            renderAnimationFrame(targetIndex, false);
        }
    }

    let isScrubbing = false;
    let activeContainer = null;

    containers.forEach(cont => {
        if (cont._hasDualListener) return;
        cont._hasDualListener = true;

        // Clic / Mousedown: ÚNICAMENTE aquí se muestra el popup y salta la posición en el mapa
        cont.addEventListener("mousedown", (e) => {
            isScrubbing = true;
            activeContainer = cont;
            updateTooltipAndJump(cont, e, true);
        });

        // Soporte táctil en pantallas móviles
        cont.addEventListener("touchstart", (e) => {
            isScrubbing = true;
            activeContainer = cont;
            updateTooltipAndJump(cont, e, true);
        }, { passive: true });

        cont.addEventListener("touchmove", (e) => {
            if (isScrubbing) {
                updateTooltipAndJump(cont, e, true);
            }
        }, { passive: true });

        cont.addEventListener("touchend", () => {
            isScrubbing = false;
        });
    });

    // Arrastre continuo mientras se mantiene presionado el ratón
    window.addEventListener("mousemove", (e) => {
        if (isScrubbing && activeContainer) {
            updateTooltipAndJump(activeContainer, e, true);
        }
    });

    window.addEventListener("mouseup", () => {
        isScrubbing = false;
    });

    // Ocultar el popup al hacer clic fuera del área de las gráficas
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".profile-chart-container") && !e.target.closest("#profile-tooltip") && !e.target.closest(".btn-profile-tab") && !e.target.closest("#btn-toggle-profile-panel")) {
            if (tooltip) tooltip.classList.add("hidden");
            hideProfileProbeFromMap();
        }
    });
}

/**
 * Sincroniza las dos agujas indicadoras de la posición actual del observador en ambos gráficos.
 * @param {number} frameIndex
 */
function updateProfileNeedle(frameIndex) {
    if (!appState.animData || !appState.animData.total_frames) return;
    const pct = (frameIndex / (appState.animData.total_frames - 1)) * 100;
    const pctStr = `${pct.toFixed(2)}%`;

    const needleIso = document.getElementById("profile-needle-iso");
    if (needleIso) needleIso.style.left = pctStr;

    const needleElev = document.getElementById("profile-needle-elev");
    if (needleElev) needleElev.style.left = pctStr;

    // Fallback retrocompatible
    const needleOld = document.getElementById("profile-needle");
    if (needleOld) needleOld.style.left = pctStr;
}


/**
 * Exporta la vista actual 3D del mapa como imagen PNG en alta resolución con membrete IMPLAN.
 * Garantiza captura nítida del lienzo WebGL y fondo institucional opaco.
 */
async function exportMapScreenshot() {
    if (!map) return;

    try {
        showToast("Generando captura en alta definición...");

        // 1. Forzar render síncrono del WebGL para capturar el búfer de dibujo actual
        map.triggerRepaint();
        await new Promise(resolve => map.once("render", resolve));

        const mapCanvas = map.getCanvas();
        const width = mapCanvas.width;
        const height = mapCanvas.height;

        const outCanvas = document.createElement("canvas");
        outCanvas.width = width;
        outCanvas.height = height;
        const ctx = outCanvas.getContext("2d");

        // 2. Pintar fondo sólido institucional oscuro (garantiza cero transparencia y evita pantalla blanca en visores)
        ctx.fillStyle = "#090d16";
        ctx.fillRect(0, 0, width, height);

        // 3. Dibujar el lienzo WebGL del mapa con todo el detalle 2D/3D (edificios, relieve, isovistas, satélite)
        ctx.drawImage(mapCanvas, 0, 0, width, height);

        // 4. Componer tarjeta de membrete institucional en la esquina inferior izquierda
        const pad = Math.round(width * 0.025);
        const cardW = Math.min(420, Math.round(width * 0.38));
        const cardH = 74;
        const cardX = pad;
        const cardY = height - pad - cardH;

        // Fondo oscuro glassmorphic
        ctx.fillStyle = "rgba(15, 23, 42, 0.90)";
        ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(cardX, cardY, cardW, cardH, 12);
        } else {
            ctx.rect(cardX, cardY, cardW, cardH);
        }
        ctx.fill();
        ctx.stroke();

        // Tipografía y textos institucionales
        ctx.fillStyle = "#38bdf8";
        ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
        ctx.fillText("IMPLAN MORELIA • CORREDOR NORTE-SUR", cardX + 16, cardY + 24);

        ctx.fillStyle = "#f8fafc";
        ctx.font = "600 15px system-ui, -apple-system, sans-serif";
        const is3D = map.getPitch() > 15 || appState.buildings3DActive || appState.terrain3DActive;
        const modeText = is3D ? "Análisis de Isovistas y Relieve 3D" : "Vista Cenital 2D • Isovistas Urbanas";
        ctx.fillText(modeText, cardX + 16, cardY + 45);

        ctx.fillStyle = "#94a3b8";
        ctx.font = "11px system-ui, -apple-system, sans-serif";
        const dateStr = new Date().toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" });
        const camStr = `Zoom: ${map.getZoom().toFixed(1)} • Pitch: ${map.getPitch().toFixed(0)}° • Rumbo: ${map.getBearing().toFixed(0)}°`;
        ctx.fillText(`${dateStr} • ${camStr}`, cardX + 16, cardY + 63);

        // 5. Descargar imagen PNG nítida
        const dataUrl = outCanvas.toDataURL("image/png");
        const link = document.createElement("a");
        const dateNow = new Date();
        const stamp = `${dateNow.getFullYear()}${String(dateNow.getMonth() + 1).padStart(2, '0')}${String(dateNow.getDate()).padStart(2, '0')}_${String(dateNow.getHours()).padStart(2, '0')}${String(dateNow.getMinutes()).padStart(2, '0')}`;
        link.download = `IMPLAN_Isovistas_Morelia_${stamp}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast("Captura HD descargada con membrete oficial");
    } catch (err) {
        console.error("Error al exportar captura:", err);
        showToast("No se pudo generar la captura");
    }
}

/**
 * Muestra una notificación toast temporal y elegante en la pantalla.
 * @param {string} msg
 */
let toastTimeout = null;
function showToast(msg) {
    const el = document.getElementById("toast-msg");
    if (!el) return;
    el.innerText = msg;
    el.classList.remove("hidden");
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        el.classList.add("hidden");
    }, 2800);
}


// ==============================================================================
// 14. PUNTO DE ENTRADA
// ==============================================================================
window.addEventListener("DOMContentLoaded", () => {
    initMap();
});

