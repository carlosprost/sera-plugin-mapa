/**
 * Localizador Geográfico 🗺️
 * Plugin Oficial de SERA v4
 *
 * Convierte coordenadas en enlaces interactivos a OpenStreetMap de forma local.
 * Genera un visualizador interactivo con mapa embebido y grilla de pines para toda la tabla.
 */

(function () {
  'use strict';

  if (typeof window.SeraAPI === 'undefined') {
    console.error('[Localizador Geográfico] window.SeraAPI no está disponible.');
    return;
  }

  const api = window.SeraAPI;
  const PLUGIN_ID = 'sera-plugin-mapa';

  // Expresión regular para capturar coordenadas lat, lng válidas
  const regexCoords = /^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/;

  // Parsea y valida el formato "lat, lng"
  const parsearCoordenadas = (val) => {
    if (!val) return null;
    const match = String(val).trim().match(regexCoords);
    if (!match) return null;
    return {
      lat: parseFloat(match[1]),
      lng: parseFloat(match[3])
    };
  };

  // 1. REGISTRAR CELL RENDERERS PARA COLUMNAS RELACIONADAS A COORDENADAS
  const columnasCoordenadas = ['coordenadas', 'coord', 'gps', 'lat_lng', 'ubicacion'];

  columnasCoordenadas.forEach((colName) => {
    api.ui.registerCellRenderer(colName, (value) => {
      if (!value) return '<span style="opacity:0.3">—</span>';
      
      const coords = parsearCoordenadas(value);
      if (!coords) return `<span>${value}</span>`;

      // Badge clickable estético a OpenStreetMap
      const osmUrl = `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lng}#map=16/${coords.lat}/${coords.lng}`;
      return `
        <a class="badge-mapa-link" href="${osmUrl}" target="_blank" title="Ver en OpenStreetMap">
          <span style="font-size:12px;vertical-align:middle;margin-right:3px">📍</span> ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}
        </a>
      `;
    });
  });

  // 2. BOTÓN EN EL RIBBON - MAPA DE REGISTROS (VISUALIZADOR UNIFICADO)
  api.ui.registerRibbonButton({
    id: `${PLUGIN_ID}-view-map-btn`,
    label: 'Mapa de Registros',
    icon: 'map',
    tooltip: 'Abre un mapa unificado con la ubicación geográfica de tus registros',
    action: async () => {
      const activeTab = document.querySelector('.desktop-tab-group .mdc-tab--active .tab-title');
      if (!activeTab) {
        api.env.showNotification('Por favor, abrí una tabla para ver su mapa de registros.', 'info');
        return;
      }

      const rawName = activeTab.textContent.trim().toLowerCase().split(' ').join('_');
      if (rawName.startsWith('res:')) {
        api.env.showNotification('Pestaña de búsqueda activa. Por favor abrí una tabla real.', 'info');
        return;
      }

      try {
        const campos = await api.data.getCampos(rawName);
        
        // Identificar el campo más probable de etiqueta (nombre, expediente, id, etc.)
        const campoEtiqueta = campos.find(c => {
          const lower = (c.Field || c.nombre || '').toLowerCase();
          return lower.includes('nombre') || lower.includes('expediente') || lower.includes('titulo') || lower.includes('cuit') || lower.includes('proveedor') || lower.includes('asunto');
        }) || campos[0];

        const idClave = `id_${rawName.toLowerCase()}`;
        
        // 1. Obtener registros seleccionados mediante los checkboxes en caliente
        let registros = await api.data.getSelectedRegistros(rawName);
        let usandoSeleccionados = true;

        if (!registros || registros.length === 0) {
          // Si no seleccionó nada, por defecto cargamos toda la tabla completa
          registros = await api.data.getContenido(rawName);
          usandoSeleccionados = false;
        }

        if (registros.length === 0) {
          api.env.showNotification('La tabla no contiene ningún registro para graficar.', 'warning');
          return;
        }

        if (usandoSeleccionados) {
          api.env.showNotification(`📍 Graficando únicamente los ${registros.length} registros seleccionados.`, 'success');
        }

        // Consultar si hay una configuración guardada para esta tabla
        const configKey = `map-config-${rawName}`;
        let savedConfig = null;
        try {
          const rawSaved = localStorage.getItem(configKey);
          if (rawSaved) savedConfig = JSON.parse(rawSaved);
        } catch (e) {
          console.warn('[Mapa] Error al leer configuración previa:', e);
        }

        if (savedConfig) {
          // Si ya existe configuración, procesamos y abrimos directamente el mapa
          await procesarUbicacionRegistros(activeTab.textContent.trim(), savedConfig, registros, idClave, campoEtiqueta, campos);
        } else {
          // Si no hay configuración previa, abrimos el configurador/selector
          abrirModalSelectorCampos(activeTab.textContent.trim(), campos, registros, idClave, campoEtiqueta);
        }

      } catch (err) {
        console.error('[Mapa] Error al procesar visualizador:', err);
        api.env.showNotification('Ocurrió un error al cargar el mapa de registros.', 'error');
      }
    }
  });

  // ─────────────────────────────────────────────
  // G. MODAL VISUALIZADOR DE MAPA EMBEBIDO
  // ─────────────────────────────────────────────
  
  const abrirModalMapaUnificado = (tituloTabla, pines, campos, registros, idClave, campoEtiqueta) => {
    // Limpiar modal viejo si quedó por algún motivo
    const modalExistente = document.getElementById('mapa-unified-modal');
    if (modalExistente) modalExistente.remove();

    // Crear overlay
    const overlay = document.createElement('div');
    overlay.className = 'mapa-modal-overlay';
    overlay.id = 'mapa-unified-modal';

    // Armar lista de pines HTML
    const pinsHtml = pines.map((p, index) => `
      <div class="pin-entry ${index === 0 ? 'active' : ''}" id="mapa-pin-${p.id}" data-lat="${p.lat}" data-lng="${p.lng}">
        <span class="pin-label">${p.etiqueta}</span>
        <span class="pin-coords">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>
      </div>
    `).join('');

    // OSM Iframe de exportación estándar
    const buildOsmEmbedUrl = (lat, lng) => {
      const delta = 0.005; // Ajustar zoom de encuadre
      return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - delta}%2C${lat - delta}%2C${lng + delta}%2C${lat + delta}&layer=mapnik&marker=${lat}%2C${lng}`;
    };

    overlay.innerHTML = `
      <div class="mapa-modal">
        <div class="mapa-modal-header">
          <div class="header-left">
            <span class="modal-icon">🗺️</span>
            <h3>Mapa de Registros — ${tituloTabla.toUpperCase()}</h3>
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <!-- BOTÓN EXPORTAR KML (GOOGLE EARTH) -->
            <button class="btn-export-kml" id="mapa-btn-export-kml" title="Exportar ubicaciones a Google Earth (KML)" style="background:rgba(76,175,80,0.1); border:1px solid rgba(76,175,80,0.3); color:#81c784; padding:6px 12px; border-radius:6px; font-weight:600; cursor:pointer; font-size:12px; transition:all 0.2s; display:flex; align-items:center; gap:4px; height:28px;">
              <span>📥</span> Exportar KML
            </button>
            <!-- BOTÓN CONFIGURAR -->
            <button class="btn-configure-mapa" id="mapa-btn-reconfigure" title="Cambiar columnas o volver a escanear" style="background:rgba(0,188,212,0.1); border:1px solid rgba(0,188,212,0.3); color:#22d3ee; padding:6px 12px; border-radius:6px; font-weight:600; cursor:pointer; font-size:12px; transition:all 0.2s; display:flex; align-items:center; gap:4px; height:28px;">
              <span>⚙️</span> Configurar
            </button>
            <button class="btn-close-modal" id="mapa-btn-close-modal">✕</button>
          </div>
        </div>
        <div class="mapa-modal-body">
          <div class="mapa-frame-container">
            <iframe 
              id="mapa-iframe-embed"
              src="${buildOsmEmbedUrl(pines[0].lat, pines[0].lng)}"
            ></iframe>
          </div>
          <div class="mapa-pins-list">
            <h4>Registros ubicados (${pines.length})</h4>
            ${pinsHtml}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Cerrar modal
    document.getElementById('mapa-btn-close-modal').addEventListener('click', () => {
      overlay.remove();
    });

    // Re-configurar / Re-escanear
    document.getElementById('mapa-btn-reconfigure').addEventListener('click', () => {
      overlay.remove();
      abrirModalSelectorCampos(tituloTabla, campos, registros, idClave, campoEtiqueta);
    });

    // Exportar KML
    document.getElementById('mapa-btn-export-kml').addEventListener('click', () => {
      try {
        let kmlContent = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        kmlContent += `<kml xmlns="http://www.opengis.net/kml/2.2">\n`;
        kmlContent += `  <Document>\n`;
        kmlContent += `    <name>SERA — ${tituloTabla}</name>\n`;
        kmlContent += `    <description>Registros georreferenciados exportados desde SERA</description>\n`;
        
        pines.forEach(p => {
          // Escapar caracteres XML para evitar romper el archivo KML
          const labelEscaped = String(p.etiqueta)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

          kmlContent += `    <Placemark>\n`;
          kmlContent += `      <name>${labelEscaped}</name>\n`;
          kmlContent += `      <description>Ubicación registrada en SERA</description>\n`;
          kmlContent += `      <Point>\n`;
          kmlContent += `        <coordinates>${p.lng},${p.lat},0</coordinates>\n`;
          kmlContent += `      </Point>\n`;
          kmlContent += `    </Placemark>\n`;
        });
        
        kmlContent += `  </Document>\n`;
        kmlContent += `</kml>\n`;

        const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        const cleanTableName = tituloTabla.toLowerCase().split(' ').join('_');
        a.download = `sera_mapa_${cleanTableName}.kml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        api.env.showNotification('¡Archivo KML exportado correctamente! Listo para abrir en Google Earth.', 'success');
      } catch (err) {
        console.error('[Mapa] Error al exportar KML:', err);
        api.env.showNotification('No se pudo exportar el archivo KML.', 'error');
      }
    });

    // Interacción al hacer click en los pines de la lista
    pines.forEach((p) => {
      const btnEntry = document.getElementById(`mapa-pin-${p.id}`);
      if (btnEntry) {
        btnEntry.addEventListener('click', () => {
          // Desactivar pin anterior activo
          const activePin = document.querySelector('.pin-entry.active');
          if (activePin) activePin.classList.remove('active');

          // Activar nuevo pin
          btnEntry.classList.add('active');

          // Actualizar Iframe
          const iframe = document.getElementById('mapa-iframe-embed');
          if (iframe) {
            iframe.src = buildOsmEmbedUrl(p.lat, p.lng);
          }
        });
      }
    });
  };

  // ─────────────────────────────────────────────
  // H. CONFIGURADOR / SELECTOR DE CAMPOS GEOGRÁFICOS
  // ─────────────────────────────────────────────
  
  const abrirModalSelectorCampos = (tituloTabla, campos, registros, idClave, campoEtiqueta) => {
    const modalId = 'mapa-selector-modal';
    const exist = document.getElementById(modalId);
    if (exist) exist.remove();

    const overlay = document.createElement('div');
    overlay.className = 'mapa-modal-overlay';
    overlay.id = modalId;

    const rawName = tituloTabla.toLowerCase().split(' ').join('_');
    const configKey = `map-config-${rawName}`;
    
    // 1. Intentar cargar configuración previa de localStorage
    let savedConfig = null;
    try {
      const rawSaved = localStorage.getItem(configKey);
      if (rawSaved) savedConfig = JSON.parse(rawSaved);
    } catch (e) {
      console.warn('[Mapa] Error al leer configuración previa:', e);
    }

    // Filtrar campos útiles (excluir de sistema o de control)
    const camposUtiles = campos.filter(c => {
      const name = (c.Field || c.nombre || '').toLowerCase();
      return name !== idClave && name !== 'id' && !name.startsWith('sera_') && name !== 'actions';
    });

    // 2. Si no hay configuración guardada, aplicar autodetección inteligente
    if (!savedConfig) {
      savedConfig = {
        tipo: 'coordenadas', // 'coordenadas' | 'direccion'
        coordTipo: 'juntas', // 'juntas' | 'separadas'
        columnaCoord: '',
        columnaLat: '',
        columnaLng: '',
        columnaCalle: '',
        columnaLocalidad: '',
        columnaProvincia: '',
        columnaPais: ''
      };

      // Autodetectar columna única de coordenadas
      const colCoordDetectada = camposUtiles.find(c => {
        const lower = (c.Field || c.nombre || '').toLowerCase();
        return ['coordenadas', 'coord', 'gps', 'lat_lng', 'ubicacion'].includes(lower);
      });
      // Autodetectar latitud/longitud por separado
      const colLatDetectada = camposUtiles.find(c => {
        const lower = (c.Field || c.nombre || '').toLowerCase();
        return ['latitud', 'lat', 'coord_lat'].includes(lower);
      });
      const colLngDetectada = camposUtiles.find(c => {
        const lower = (c.Field || c.nombre || '').toLowerCase();
        return ['longitud', 'lng', 'lon', 'coord_lng'].includes(lower);
      });

      if (colCoordDetectada) {
        savedConfig.columnaCoord = colCoordDetectada.Field || colCoordDetectada.nombre;
      } else if (colLatDetectada && colLngDetectada) {
        savedConfig.coordTipo = 'separadas';
        savedConfig.columnaLat = colLatDetectada.Field || colLatDetectada.nombre;
        savedConfig.columnaLng = colLngDetectada.Field || colLngDetectada.nombre;
      } else {
        // Autodetectar campos de dirección postal
        const colCalleDetectada = camposUtiles.find(c => {
          const lower = (c.Field || c.nombre || '').toLowerCase();
          return ['calle', 'direccion', 'dir', 'domicilio', 'postal'].includes(lower);
        });
        const colLocDetectada = camposUtiles.find(c => {
          const lower = (c.Field || c.nombre || '').toLowerCase();
          return ['localidad', 'ciudad', 'municipio', 'partido'].includes(lower);
        });
        const colProvDetectada = camposUtiles.find(c => {
          const lower = (c.Field || c.nombre || '').toLowerCase();
          return ['provincia', 'estado', 'jurisdiccion', 'prov'].includes(lower);
        });
        const colPaisDetectada = camposUtiles.find(c => {
          const lower = (c.Field || c.nombre || '').toLowerCase();
          return ['pais', 'nacion', 'country'].includes(lower);
        });

        if (colCalleDetectada) {
          savedConfig.tipo = 'direccion';
          savedConfig.columnaCalle = colCalleDetectada.Field || colCalleDetectada.nombre;
          if (colLocDetectada) savedConfig.columnaLocalidad = colLocDetectada.Field || colLocDetectada.nombre;
          if (colProvDetectada) savedConfig.columnaProvincia = colProvDetectada.Field || colProvDetectada.nombre;
          if (colPaisDetectada) savedConfig.columnaPais = colPaisDetectada.Field || colPaisDetectada.nombre;
        }
      }
    }

    // Armar las opciones para los combos de campos
    const buildOptionsHtml = (selectedVal) => {
      const nullOpt = `<option value="">[Ninguno]</option>`;
      const listOpts = camposUtiles.map(c => {
        const val = c.Field || c.nombre;
        const label = val.split('_').join(' ').toUpperCase();
        return `<option value="${val}" ${val === selectedVal ? 'selected' : ''}>${label}</option>`;
      }).join('');
      return nullOpt + listOpts;
    };

    overlay.innerHTML = `
      <div class="mapa-modal" style="max-width: 480px; height: auto; min-height: 420px; padding: 24px; display:flex; flex-direction:column; gap:16px;">
        <div class="mapa-modal-header" style="padding-bottom:12px; border-bottom: 1px solid rgba(255,255,255,0.08)">
          <div class="header-left">
            <span class="modal-icon">📍</span>
            <h3 style="margin:0; font-size:16px; font-weight:600;">Configurar Mapa — ${tituloTabla.toUpperCase()}</h3>
          </div>
          <button class="btn-close-modal" id="mapa-btn-close-selector">✕</button>
        </div>
        <div class="mapa-modal-body" style="display:flex; flex-direction:column; gap:16px; flex:none; height:auto; overflow:visible;">
          
          <!-- SECCIÓN 1: RADIO DE MÉTODO (COORDENADAS VS DIRECCIÓN) -->
          <div style="display:flex; flex-direction:column; gap:8px;">
            <span style="font-size:12px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px;">Método de Ubicación:</span>
            <div style="display:flex; gap:20px; background:rgba(0,0,0,0.15); padding:10px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.04);">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:600; color:#cbd5e1;">
                <input type="radio" name="mapa-radio-metodo" id="mapa-radio-metodo-coords" value="coordenadas" ${savedConfig.tipo === 'coordenadas' ? 'checked' : ''} style="accent-color:#00bcd4; width:16px; height:16px;">
                Coordenadas GPS
              </label>
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:600; color:#cbd5e1;">
                <input type="radio" name="mapa-radio-metodo" id="mapa-radio-metodo-dir" value="direccion" ${savedConfig.tipo === 'direccion' ? 'checked' : ''} style="accent-color:#00bcd4; width:16px; height:16px;">
                Dirección Postal
              </label>
            </div>
          </div>

          <!-- SECCIÓN 2: CONTENEDOR COORDENADAS -->
          <div id="mapa-container-metodo-coords" style="display:flex; flex-direction:column; gap:14px;">
            <!-- Sub-tipo de Coordenadas -->
            <div style="display:flex; flex-direction:column; gap:8px;">
              <span style="font-size:12px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px;">Estructura de Coordenadas:</span>
              <div style="display:flex; gap:20px; padding:2px 4px;">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; color:#cbd5e1;">
                  <input type="radio" name="mapa-radio-coords-tipo" id="mapa-radio-coords-juntas" value="juntas" ${savedConfig.coordTipo === 'juntas' ? 'checked' : ''} style="accent-color:#00bcd4; width:15px; height:15px;">
                  En una columna (Ej: "lat, lng")
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; color:#cbd5e1;">
                  <input type="radio" name="mapa-radio-coords-tipo" id="mapa-radio-coords-separadas" value="separadas" ${savedConfig.coordTipo === 'separadas' ? 'checked' : ''} style="accent-color:#00bcd4; width:15px; height:15px;">
                  Columnas separadas (Lat / Lng)
                </label>
              </div>
            </div>

            <!-- Seleccion de Columna Única (Juntas) -->
            <div id="mapa-coords-juntas-selection" style="display:flex; flex-direction:column; gap:6px;">
              <label style="font-size:13px; color:#cbd5e1; font-weight:600;">Columna de Coordenadas:</label>
              <select id="mapa-select-col-coords" style="background:#1e293b; color:#f1f5f9; border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:8px 12px; font-size:13px; width:100%; outline:none; cursor:pointer; transition:all 0.2s;">
                ${buildOptionsHtml(savedConfig.columnaCoord)}
              </select>
            </div>

            <!-- Seleccion de Columnas Separadas (Lat/Lng) -->
            <div id="mapa-coords-separadas-selection" style="display:flex; gap:12px; width:100%;">
              <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
                <label style="font-size:13px; color:#cbd5e1; font-weight:600;">Columna Latitud:</label>
                <select id="mapa-select-col-lat" style="background:#1e293b; color:#f1f5f9; border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:8px 12px; font-size:13px; width:100%; outline:none; cursor:pointer;">
                  ${buildOptionsHtml(savedConfig.columnaLat)}
                </select>
              </div>
              <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
                <label style="font-size:13px; color:#cbd5e1; font-weight:600;">Columna Longitud:</label>
                <select id="mapa-select-col-lng" style="background:#1e293b; color:#f1f5f9; border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:8px 12px; font-size:13px; width:100%; outline:none; cursor:pointer;">
                  ${buildOptionsHtml(savedConfig.columnaLng)}
                </select>
              </div>
            </div>
          </div>

          <!-- SECCIÓN 3: CONTENEDOR DIRECCIÓN POSTAL (4 SELECTS) -->
          <div id="mapa-container-metodo-dir" style="display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; gap:12px; width:100%;">
              <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
                <label style="font-size:13px; color:#cbd5e1; font-weight:600;">Dirección / Calle:</label>
                <select id="mapa-select-col-calle" style="background:#1e293b; color:#f1f5f9; border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:8px 12px; font-size:13px; width:100%; outline:none; cursor:pointer;">
                  ${buildOptionsHtml(savedConfig.columnaCalle)}
                </select>
              </div>
              <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
                <label style="font-size:13px; color:#cbd5e1; font-weight:600;">Localidad:</label>
                <select id="mapa-select-col-localidad" style="background:#1e293b; color:#f1f5f9; border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:8px 12px; font-size:13px; width:100%; outline:none; cursor:pointer;">
                  ${buildOptionsHtml(savedConfig.columnaLocalidad)}
                </select>
              </div>
            </div>
            <div style="display:flex; gap:12px; width:100%;">
              <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
                <label style="font-size:13px; color:#cbd5e1; font-weight:600;">Provincia / Estado:</label>
                <select id="mapa-select-col-provincia" style="background:#1e293b; color:#f1f5f9; border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:8px 12px; font-size:13px; width:100%; outline:none; cursor:pointer;">
                  ${buildOptionsHtml(savedConfig.columnaProvincia)}
                </select>
              </div>
              <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
                <label style="font-size:13px; color:#cbd5e1; font-weight:600;">País:</label>
                <select id="mapa-select-col-pais" style="background:#1e293b; color:#f1f5f9; border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:8px 12px; font-size:13px; width:100%; outline:none; cursor:pointer;">
                  ${buildOptionsHtml(savedConfig.columnaPais)}
                </select>
              </div>
            </div>
          </div>

          <!-- BOTÓN PRINCIPAL -->
          <button id="mapa-btn-geolocalizar" class="btn-mapa-geolocalizar" style="background:var(--sera-primary-color, #00bcd4); color:#000; border:none; padding:10px; border-radius:8px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; transition:all 0.2s; height:40px; width:100%; margin-top:8px;">
            <span>Ubicar Registros</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Lógica dinámica de visibilidad en caliente
    const actualizarVisibilidadCampos = () => {
      const metodoCoords = document.getElementById('mapa-radio-metodo-coords').checked;
      const containerCoords = document.getElementById('mapa-container-metodo-coords');
      const containerDir = document.getElementById('mapa-container-metodo-dir');

      if (metodoCoords) {
        containerCoords.style.display = 'flex';
        containerDir.style.display = 'none';

        const coordsJuntas = document.getElementById('mapa-radio-coords-juntas').checked;
        const selectionJuntas = document.getElementById('mapa-coords-juntas-selection');
        const selectionSeparadas = document.getElementById('mapa-coords-separadas-selection');

        if (coordsJuntas) {
          selectionJuntas.style.display = 'flex';
          selectionSeparadas.style.display = 'none';
        } else {
          selectionJuntas.style.display = 'none';
          selectionSeparadas.style.display = 'flex';
        }
      } else {
        containerCoords.style.display = 'none';
        containerDir.style.display = 'flex';
      }
    };

    // Registrar los event listeners dinámicos de los radios
    document.getElementById('mapa-radio-metodo-coords').addEventListener('change', actualizarVisibilidadCampos);
    document.getElementById('mapa-radio-metodo-dir').addEventListener('change', actualizarVisibilidadCampos);
    document.getElementById('mapa-radio-coords-juntas').addEventListener('change', actualizarVisibilidadCampos);
    document.getElementById('mapa-radio-coords-separadas').addEventListener('change', actualizarVisibilidadCampos);

    // Inicializar la vista
    actualizarVisibilidadCampos();

    // Agregar estilos de focus en caliente
    const selectors = overlay.querySelectorAll('select');
    selectors.forEach(sel => {
      sel.addEventListener('focus', () => {
        sel.style.borderColor = '#00bcd4';
        sel.style.boxShadow = '0 0 8px rgba(0, 188, 212, 0.2)';
      });
      sel.addEventListener('blur', () => {
        sel.style.borderColor = 'rgba(255,255,255,0.12)';
        sel.style.boxShadow = 'none';
      });
    });

    // Cerrar modal
    document.getElementById('mapa-btn-close-selector').addEventListener('click', () => {
      overlay.remove();
    });

    // Acción principal: Ubicar Registros
    document.getElementById('mapa-btn-geolocalizar').addEventListener('click', async () => {
      const esCoords = document.getElementById('mapa-radio-metodo-coords').checked;
      const config = {
        tipo: esCoords ? 'coordenadas' : 'direccion',
        coordTipo: document.getElementById('mapa-radio-coords-juntas').checked ? 'juntas' : 'separadas',
        columnaCoord: document.getElementById('mapa-select-col-coords').value,
        columnaLat: document.getElementById('mapa-select-col-lat').value,
        columnaLng: document.getElementById('mapa-select-col-lng').value,
        columnaCalle: document.getElementById('mapa-select-col-calle').value,
        columnaLocalidad: document.getElementById('mapa-select-col-localidad').value,
        columnaProvincia: document.getElementById('mapa-select-col-provincia').value,
        columnaPais: document.getElementById('mapa-select-col-pais').value
      };

      // Validaciones básicas de campos vacíos
      if (config.tipo === 'coordenadas') {
        if (config.coordTipo === 'juntas' && !config.columnaCoord) {
          api.env.showNotification('Por favor, seleccioná la columna que contiene las coordenadas.', 'warning');
          return;
        }
        if (config.coordTipo === 'separadas' && (!config.columnaLat || !config.columnaLng)) {
          api.env.showNotification('Por favor, seleccioná ambas columnas (Latitud y Longitud).', 'warning');
          return;
        }
      } else {
        if (!config.columnaCalle) {
          api.env.showNotification('Por favor, seleccioná al menos la columna de Dirección / Calle.', 'warning');
          return;
        }
      }

      // Guardar configuración en localStorage
      try {
        localStorage.setItem(configKey, JSON.stringify(config));
      } catch (e) {
        console.error('[Mapa] Error al persistir configuración:', e);
      }

      overlay.remove();

      // Iniciar el procesamiento de registros en caliente
      await procesarUbicacionRegistros(tituloTabla, config, registros, idClave, campoEtiqueta, campos);
    });
  };

  const procesarUbicacionRegistros = async (tituloTabla, config, registros, idClave, campoEtiqueta, campos) => {
    if (config.tipo === 'coordenadas') {
      const pines = [];
      
      registros.forEach((r) => {
        let coords = null;
        if (config.coordTipo === 'juntas') {
          const valCoord = r[config.columnaCoord];
          coords = parsearCoordenadas(valCoord);
        } else {
          // Coordenadas en columnas separadas
          const valLat = r[config.columnaLat];
          const valLng = r[config.columnaLng];
          
          if (valLat !== undefined && valLat !== null && valLng !== undefined && valLng !== null) {
            const latFloat = parseFloat(String(valLat).trim());
            const lngFloat = parseFloat(String(valLng).trim());
            if (!isNaN(latFloat) && !isNaN(lngFloat) && latFloat >= -90 && latFloat <= 90 && lngFloat >= -180 && lngFloat <= 180) {
              coords = { lat: latFloat, lng: lngFloat };
            }
          }
        }

        if (coords) {
          const etiqueta = r[campoEtiqueta.Field || campoEtiqueta.nombre] || `Registro #${r[idClave] || r['id'] || ''}`;
          pines.push({
            id: r[idClave] || r['id'] || Math.random().toString(),
            etiqueta: etiqueta,
            lat: coords.lat,
            lng: coords.lng
          });
        }
      });

      if (pines.length === 0) {
        api.env.showNotification('No se encontraron registros con coordenadas válidas para graficar.', 'warning');
        return;
      }

      api.env.showNotification(`Éxito: Se ubicaron ${pines.length} registros mediante coordenadas GPS.`, 'success');
      abrirModalMapaUnificado(tituloTabla, pines, campos, registros, idClave, campoEtiqueta);
    } else {
      // Geolocalizar por dirección postal (con barra de progreso y cache persistente en localStorage)
      await iniciarGeocodingProceso(tituloTabla, config, registros, idClave, campoEtiqueta, campos);
    }
  };

  const iniciarGeocodingProceso = async (tituloTabla, config, registros, idClave, campoEtiqueta, campos) => {
    // Inyectar overlay de carga
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'mapa-modal-overlay';
    loadingOverlay.id = 'mapa-loading-overlay';
    loadingOverlay.innerHTML = `
      <div class="mapa-modal" style="max-width: 340px; text-align:center; padding:32px; display:flex; flex-direction:column; align-items:center; gap:16px; height:auto; min-height:180px;">
        <span style="font-size:36px; animation: bounce 1s infinite; display:inline-block;">🗺️</span>
        <h4 style="margin:0; font-size:14px; font-weight:600; color:#e2e8f0;">Georreferenciando Direcciones...</h4>
        <p id="mapa-loading-text" style="margin:0; font-size:12px; opacity:0.7; color:#94a3b8;">Procesando registros...</p>
        <div style="width:100%; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; position:relative; margin-top:8px;">
          <div id="mapa-progress-bar" style="width:0%; height:100%; background:var(--sera-primary-color, #00bcd4); transition:width 0.2s ease;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(loadingOverlay);

    // 1. Cargar caché de geocodificación de localStorage
    const cacheKey = 'sera-map-geocode-cache';
    let geocodeCache = {};
    try {
      const rawCache = localStorage.getItem(cacheKey);
      if (rawCache) geocodeCache = JSON.parse(rawCache);
    } catch (e) {
      console.warn('[Mapa] Error al leer caché de geocodificación:', e);
    }

    const pines = [];
    const total = registros.length;
    let procesados = 0;

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < total; i++) {
      const r = registros[i];
      
      // Componer la dirección concatenando calle, localidad, provincia, país
      const partes = [
        config.columnaCalle ? r[config.columnaCalle] : null,
        config.columnaLocalidad ? r[config.columnaLocalidad] : null,
        config.columnaProvincia ? r[config.columnaProvincia] : null,
        config.columnaPais ? r[config.columnaPais] : null
      ].filter(val => val !== undefined && val !== null && String(val).trim() !== '');

      const direccionCompleta = partes.join(', ').trim();

      if (direccionCompleta) {
        // Consultar el caché de geolocalización
        if (geocodeCache[direccionCompleta]) {
          const coords = geocodeCache[direccionCompleta];
          const etiqueta = r[campoEtiqueta.Field || campoEtiqueta.nombre] || `Registro #${r[idClave] || r['id'] || ''}`;
          pines.push({
            id: r[idClave] || r['id'] || Math.random().toString(),
            etiqueta: `${etiqueta} (${direccionCompleta})`,
            lat: coords.lat,
            lng: coords.lng
          });
        } else {
          try {
            // LLAMADA A NOMINATIM (OSM)
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(direccionCompleta)}&limit=1`, {
              headers: {
                'Accept-Language': 'es'
              }
            });

            if (response.ok) {
              const data = await response.json();
              if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                
                // Guardar en el caché
                geocodeCache[direccionCompleta] = { lat, lng };
                
                const etiqueta = r[campoEtiqueta.Field || campoEtiqueta.nombre] || `Registro #${r[idClave] || r['id'] || ''}`;
                pines.push({
                  id: r[idClave] || r['id'] || Math.random().toString(),
                  etiqueta: `${etiqueta} (${direccionCompleta})`,
                  lat: lat,
                  lng: lng
                });
              }
            }
          } catch (e) {
            console.warn(`[Localizador Mapa] Error de geocoding para: ${direccionCompleta}`, e);
          }

          // Delay de 1 segundo estricto para Nominatim (cooldown de políticas de OSM)
          await delay(1000);
        }
      }

      procesados++;
      const pct = Math.round((procesados / total) * 100);
      const progressBar = document.getElementById('mapa-progress-bar');
      const progressText = document.getElementById('mapa-loading-text');
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressText) progressText.textContent = `Procesando ${procesados} de ${total} registros...`;
    }

    // 2. Persistir caché actualizado en localStorage
    try {
      localStorage.setItem(cacheKey, JSON.stringify(geocodeCache));
    } catch (e) {
      console.warn('[Mapa] Error al persistir caché de geocodificación:', e);
    }

    loadingOverlay.remove();

    if (pines.length === 0) {
      api.env.showNotification('No se pudo geolocalizar ninguna dirección de forma exitosa en OpenStreetMap.', 'warning');
      return;
    }

    api.env.showNotification(`Georreferenciación exitosa: Se ubicaron ${pines.length} de ${total} registros.`, 'success');
    abrirModalMapaUnificado(tituloTabla, pines, campos, registros, idClave, campoEtiqueta);
  };

  // Notificación de carga
  api.env.showNotification('🧩 Localizador Geográfico 🗺️ cargado correctamente', 'info');
  console.log('[Mapa] Plugin inicializado correctamente ✅');

})();
