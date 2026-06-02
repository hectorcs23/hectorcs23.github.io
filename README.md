# Optimizador de Cargas · Horno Campana Ternium

Aplicación web para optimizar cargas de rollos de acero en el proceso de recocido. Toma como entrada un archivo Excel de inventario y sugiere combinaciones de rollos que maximizan el llenado del horno mientras minimizan los movimientos de grúa.

## Características

- **Carga de Excel** con auto-detección de 3 formatos (PRAM, CHU/Práctica, LAV Guerrero)
- **Visualización 2D** del almacén: cuadro 46–54 con niveles S/C/A + línea 1–40 + estibas A–G
- **5 estrategias de optimización**: Best loads (default), Altura, Peso, Balanceada, Antigüedad
- **Dos modos de sugerencia**:
  - *Ranked*: top N cargas independientes (pueden traslapar rollos)
  - *Sin repetir*: N cargas con rollos disjuntos (planeación de campaña)
- **Costo de grúa** integrado al score: penaliza bloqueos (rollos enterrados) y traslados entre estibas
- **Restricciones físicas**: altura ≤ 5200 mm, peso ≤ 180 t, ≤ 5 rollos, misma práctica, no mezclar LAV/no-LAV, calibre ≤ 25 en P1
- **Detección de conflictos**: posiciones con dos rollos asignados al mismo slot físico
- **Exclusión de rollos dañados**: click derecho sobre cualquier rollo
- **Cargas confirmadas** con KPIs detallados (8 indicadores), visualización del apilado físico, tabla por rollo
- **Comparador**: corre las 5 estrategias en paralelo y muestra cuál optimiza mejor el inventario actual
- **Estadísticas** del inventario: distribución por práctica, ancho, antigüedad, conflictos
- **Exportación a Excel** con 4 hojas: Resumen, Detalle, Parámetros, No asignados
- **Persistencia** entre sesiones (localStorage del navegador)

## Cómo ejecutar localmente

Solo abre `index.html` en cualquier navegador moderno. No necesita servidor — todo el procesamiento ocurre en el navegador.

```bash
# Opción 1: doble click sobre index.html
# Opción 2: servidor local rápido (Python)
python -m http.server 8000
# Y abrir http://localhost:8000
```

## Cómo desplegar en GitHub Pages (recomendado)

GitHub Pages es gratis, sin servidor, perfecto para distribuir a stockers vía un solo link.

### Pasos

1. **Crear repositorio en GitHub**
   - Entra a https://github.com/new
   - Nombre: `optimizador-cargas-ternium` (o el que prefieras)
   - Público
   - Inicializar con README: opcional

2. **Subir los archivos**
   - Opción A (interfaz web): arrastra todos los archivos del proyecto al repo
   - Opción B (Git CLI):
     ```bash
     cd ternium-optimizer
     git init
     git add .
     git commit -m "Versión inicial"
     git branch -M main
     git remote add origin https://github.com/TU_USUARIO/optimizador-cargas-ternium.git
     git push -u origin main
     ```

3. **Activar GitHub Pages**
   - En el repo, ve a **Settings → Pages**
   - En "Source", selecciona la rama `main` y carpeta `/ (root)`
   - Guarda
   - En 1–2 minutos tendrás tu URL: `https://TU_USUARIO.github.io/optimizador-cargas-ternium/`

4. **Compartir el link** con los stockers. No necesitan instalar nada — solo entran al link, suben el Excel, descargan resultados.

### Actualizaciones futuras

Cada vez que hagas cambios al código:

```bash
git add .
git commit -m "Descripción del cambio"
git push
```

GitHub Pages se actualiza automáticamente en 30–60 segundos. Los usuarios solo refrescan la página y ven la nueva versión.

## Privacidad y seguridad

**100% client-side**. El Excel nunca se sube a ningún servidor. Todo el cálculo ocurre en el navegador del usuario. Puedes verificarlo abriendo DevTools → Network durante el uso: no hay requests salientes después de cargar la página.

La única dependencia externa es la librería SheetJS desde CDN (`cdn.sheetjs.com`), usada solo para leer/escribir archivos Excel. Si Ternium prefiere cero CDN, descarga `xlsx.full.min.js` localmente y cambia la línea en `index.html`:

```html
<!-- antes -->
<script src="https://cdn.sheetjs.com/..."></script>
<!-- después -->
<script src="lib/xlsx.full.min.js"></script>
```

## Estructura del proyecto

```
ternium-optimizer/
├── index.html              # Página principal
├── css/
│   └── styles.css         # Estilos
├── js/
│   ├── parsers.js         # Lectura de Excel + auto-detección de formato
│   ├── optimizer.js       # Lógica de optimización (5 estrategias, crane cost)
│   ├── visualization.js   # Renderizado del cuadro y la línea
│   ├── exporter.js        # Exportación a Excel
│   └── app.js             # Estado y orquestación de la UI
├── inventario_ejemplo.xlsx # Excel de prueba
└── README.md              # Este archivo
```

## Modelo de costo de grúa

Para cada rollo, el costo de extraerlo del almacén depende de su nivel vertical:

| Nivel | Costo |
|-------|-------|
| S (Superior) | 0 — acceso directo |
| C (Centro)   | 1 — el S está encima |
| A (Abajo)    | 2 — C y S están encima |

Adicionalmente, cada **traslado entre estibas** suma 1 al costo.

**Bloqueo** se descuenta cuando un rollo "encima" también va en la misma carga (te lo llevas de paso, no es un movimiento extra).

Fórmula general:
```
score_final = score_estrategia − λ · (bloqueos + traslados_extra) / 10
```

Donde `λ ∈ [0, 0.5]` ajusta cuánto importa la accesibilidad versus el llenado físico.

## Fórmulas por estrategia

| Estrategia    | Fórmula |
|---------------|---------|
| Best loads    | `0.45·h + 0.45·w + 0.10·(n/5) − λ·grúa/10` |
| Altura        | `h − λ·grúa/10` |
| Peso          | `w − λ·grúa/10` |
| Balanceada    | `(h+w)/2 − λ·grúa/10` |
| Antigüedad    | `0.25·(h+w) + 0.5·antig/30 − λ·grúa/10` |

donde `h = altura_total / 5200`, `w = peso_total / 180000`, `n = # rollos`, `antig = antigüedad_promedio_días`.

## Bibliografía

- Moon & Hrymak (1999). *Scheduling of the batch annealing process — deterministic case*. Computers & Chemical Engineering, 23, 1193–1208.
- Tang, Xie & Liu (2009). Scheduling of a single crane in batch annealing process. *Computers & Operations Research*, 36, 2853–2865.
- Liu et al. (2013). Multi-crane scheduling in steel coil warehouse. *Expert Systems with Applications*, 40(17).
- Hosseini et al. (2024). The integrated planning of outgoing coil selection for retrieval, multi-crane scheduling, and location assignment. *Computers & Industrial Engineering*, Elsevier.
- Tang, Zhao & Liu (2012). Logistics optimisation of slab pre-marshalling problem in steel industry. *IIE Transactions*.

## Pendientes conocidos

- **Calibre vacío**: el Excel de ejemplo tiene la columna `Calibre` sin datos para los rollos del cuadro. Cuando la pueblen, la restricción "calibre ≤ 25 en P1" se aplicará automáticamente.
- **Niveles en línea 1–40 y A–G**: el Excel no incluye el nivel (S/C/A) para esa zona. La app auto-asigna por antigüedad. Cuando el sistema de inventario lo registre, el formato esperado sería `15a`, `15c`, `15s` (igual que el cuadro).
- **Digital twin del almacén**: pendiente — visualización 3D del estado físico real.

## Soporte

Para reportar errores o sugerir mejoras, abre un issue en el repo de GitHub.
