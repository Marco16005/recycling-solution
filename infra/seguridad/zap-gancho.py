# Plan de seguridad: gancho de zap-baseline.py (--hook). Antes de cerrar ZAP guarda la petición y la respuesta completas
# de cada alerta que no está aceptada en reglas.tsv, en alertas-con-mensaje.json de la carpeta del reporte. Así una
# alerta que no se reproduce a mano se puede investigar con lo que ZAP vio (2026-11-07: 10096 en «/» con sesión).
import json


def zap_pre_shutdown(zap):
    aceptadas = set()
    try:
        with open('/zap/wrk/reglas.tsv', encoding='utf-8') as reglas:
            for linea in reglas:
                partes = linea.split('\t')
                if len(partes) >= 2 and partes[1].strip() == 'IGNORE':
                    aceptadas.add(partes[0].strip())
    except OSError:
        pass
    salida = []
    for alerta in zap.core.alerts():
        if alerta.get('pluginId') in aceptadas or alerta.get('risk') == 'Informational':
            continue
        mensaje = zap.core.message(alerta.get('messageId'))
        salida.append({
            'regla': alerta.get('pluginId'),
            'nombre': alerta.get('alert'),
            'url': alerta.get('url'),
            'evidencia': alerta.get('evidence'),
            'peticion': mensaje.get('requestHeader'),
            'respuesta_encabezados': mensaje.get('responseHeader'),
            'respuesta': (mensaje.get('responseBody') or '')[:300000],
        })
    with open('/zap/wrk/alertas-con-mensaje.json', 'w', encoding='utf-8') as archivo:
        json.dump(salida, archivo, ensure_ascii=False, indent=1)
