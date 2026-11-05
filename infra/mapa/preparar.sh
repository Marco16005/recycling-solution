#!/bin/sh
# Prepara el mapa de OSRM en /mapa (volumen). Plan 7, §6. Idempotente.
#   preparar-mapa real   → descarga el extracto FECHADO de México (Geofabrik), verifica su md5, lo recorta a MAPA_CAJA y lo procesa.
#   preparar-mapa prueba → procesa /mapa/prueba.osm, la cuadrícula sintética propia de las pruebas.
# Deja /mapa/mapa.osrm* y /mapa/mapa.id (el identificador que OSRM devuelve como data_version).
set -eu
modo=${1:?Uso: preparar-mapa real|prueba}
cd /mapa

# Plan de seguridad (S7): osrm-routed corre como nobody y solo lee; osrm-extract deja mapa.osrm.fileIndex en 0700.
legible() { chmod -R a+rX /mapa; }

case "$modo" in
  real)
    : "${MAPA_FECHA:?Falta MAPA_FECHA: AAMMDD de un extracto listado en https://download.geofabrik.de/north-america/mexico.html}"
    : "${MAPA_CAJA:?Falta MAPA_CAJA: oeste,sur,este,norte}"
    id="geofabrik-mexico-${MAPA_FECHA} recorte ${MAPA_CAJA}"
    if [ -f mapa.osrm.mldgr ] && [ "$(cat mapa.id 2>/dev/null)" = "$id" ]; then
      legible
      echo "El mapa ya está preparado: $id"
      exit 0
    fi
    archivo="mexico-${MAPA_FECHA}.osm.pbf"
    url="https://download.geofabrik.de/north-america/${archivo}"
    if ! curl -fsSL -o "$archivo.md5" "$url.md5"; then
      echo "Geofabrik ya no tiene $archivo. Elige una fecha vigente en https://download.geofabrik.de/north-america/mexico.html"
      exit 1
    fi
    if [ ! -f "$archivo" ] || ! md5sum -c --status "$archivo.md5"; then
      echo "Descargando $archivo…"
      curl -fL --retry 3 -o "$archivo.parcial" "$url"
      mv "$archivo.parcial" "$archivo"
    fi
    md5sum -c "$archivo.md5"
    echo "Recortando a $MAPA_CAJA…"
    osmium extract --overwrite -b "$MAPA_CAJA" -o mapa.osm.pbf "$archivo"
    entrada=mapa.osm.pbf
    extra=""
    ;;
  prueba)
    id="prueba-cuadricula"
    cp prueba.osm mapa.osm
    entrada=mapa.osm
    # La isla de calles de la prueba debe quedar como componente propio para producir celdas sin ruta.
    extra="--small-component-size 1"
    ;;
  *)
    echo "Modo desconocido: $modo (usa real o prueba)"
    exit 2
    ;;
esac

rm -f mapa.osrm*
# shellcheck disable=SC2086
osrm-extract -p /opt/car.lua --data_version "$id" $extra "$entrada"
osrm-partition mapa.osrm
osrm-customize mapa.osrm
rm -f "$entrada"
# Sin restos de extractos (también de descargas cortadas de otras fechas): el volumen solo guarda el mapa procesado.
[ "$modo" = real ] && rm -f mexico-*.osm.pbf mexico-*.osm.pbf.parcial mexico-*.osm.pbf.md5
printf '%s' "$id" > mapa.id
legible
echo "Mapa listo: $id"
