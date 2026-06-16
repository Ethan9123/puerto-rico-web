# Puerto Rico — Edición Web

> Una adaptación para un jugador del clásico juego de estrategia, jugable en el navegador. IA evolucionada durante más de 700 generaciones a partir del [evolucionador de Excel de Puerto Rico de Tony Mitton (BGG #8766)](https://boardgamegeek.com/filepage/8766/pr-030205zip), con el reglamento original de Rio Grande 2002.

🌐 **Idioma / Language**：[中文](README.md) · [English](README.en.md) · [Français](README.fr.md) · **Español**

---

## 🌐 Jugar

### En línea
**👉 [https://ethan9123.github.io/puerto-rico-web/](https://ethan9123.github.io/puerto-rico-web/) 👈** (GitHub Pages)

Espejos (usa el que cargue): [Cloudflare Workers](https://puerto-rico-web.ethanfu95.workers.dev/) · [Vercel](https://puerto-rico-web.vercel.app/)

### Sin conexión (sin instalación, sin servidor)
1. Consigue el paquete `puerto-rico-web-{fecha}.zip` (~6,8 MB).
2. Descomprímelo donde quieras.
3. **Haz doble clic en `index.html`** — se abre en tu navegador y empieza al instante.

Totalmente sin conexión y permanente: sin red, sin servidor local, sin instalación. Todas las IA (incluido el ADN evolucionado y la red neuronal «Gran Maestro»), todos los edificios y todas las reglas están integrados en local. El paquete solo contiene archivos web normales (sin `.exe` / `.bat` / instalador / macros): si un antivirus da un falso positivo, puedes restaurar la carpeta y añadirla a la lista de confianza sin problema.

> 🇨🇳 Las notas de acceso desde China continental (GFW, distribución por WeChat, registro ICP) se mantienen en el README en chino y en **[CN-ACCESS.md](CN-ACCESS.md)**.

---

## ✨ Características

### 🎮 Juego completo
- **3 / 4 / 5 jugadores**, con doblones iniciales, reserva de colonos, reserva de PV, capacidad de los barcos y número de cartas de Rol ajustados automáticamente según las reglas oficiales.
- **Los 23 edificios** + 5 mercancías + 7 roles (Colono / Alcalde / Constructor / Capataz / Comerciante / Capitán / Buscador de Oro).
- **Reglas fieles**: plantaciones iniciales repartidas en el orden del gobernador, primer gobernador aleatorio, los disparadores de última ronda (12 espacios / reserva de PV / reserva de colonos), carga obligatoria del Capitán, privilegio del Capataz limitado a una mercancía producida esta ronda, privilegio +1 del Alcalde para quien elige, etc.
- **Ilustraciones de los edificios de [BGG 42234 — Anniversary Edition (Greg May)](https://boardgamegeek.com/filepage/42234/base-game-and-expansion-buildings-illustrated)**.

### 🤖 6 niveles de dificultad de la IA (cada CPU se configura por separado)

| Nivel | Nombre | Qué hace |
|---|---|---|
| **N1** | Principiante (Beginner) | Juego simple e intuitivo que aprovecha sus puntos fuertes: pocos colonos → Alcalde, muchas mercancías → Capitán, suficiente dinero → Constructor. |
| **N2** | Evolución (DNA) | IA puramente de ADN, evolucionada durante más de 700 generaciones en el evolucionador VBA de Tony Mitton (5 reservas por asiento × 10 cada una = 50 ADN). |
| **N3** | Normal (Normal) | + conciencia de las bonificaciones de las cartas de Rol + bloqueo de las mercancías del vecino siguiente. |
| **N4** | Difícil (Hard) | + **contrajuego de bloqueo en todo el tablero** (negar Capitán / Constructor / Comerciante / Capataz / Alcalde) + tendencias estratégicas con puntuación blanda + anticipación por instantánea a 2 niveles. |
| **N5** | Experto (Expert) | **ISMCTS** (búsqueda en árbol de Monte-Carlo sobre conjuntos de información): determinización del mazo oculto + UCB1 + simulaciones heurísticas, pensando cada vez más a fondo. |
| **N6** | Gran Maestro (Grandmaster) | **AlphaZero**: una red neuronal entrenada por autojuego que guía el MCTS (política/valor de la red + PUCT). El más fuerte. |

### 🧠 Tiempo de reflexión de la IA ajustable

Elige «tiempo de reflexión de la IA» en la pantalla de configuración (presupuesto de búsqueda para el Experto N5 / el Gran Maestro N6):
- 🚀 **Rápido** (0,1 s) — para ver a las IA enfrentarse
- ⚖️ **Normal** (1,5 s)
- 🧠 **Profundo** (6 s · por defecto) — anticipación de 2 rondas
- 💎 **Extremo** (10 s) — muy recomendado contra la IA

Las IA Difícil / Experto / Gran Maestro **analizan en tiempo real las amenazas del jugador humano** (cantidad de mercancías, grandes edificios violeta asequibles, mejor precio de venta, capacidad de producción, puestos de trabajo vacíos) y toman roles de forma preventiva para contrarrestarlas.

### 🎨 Detalles de experiencia de juego

- **Información al pasar el cursor sobre edificios / roles**: cada edificio muestra coste, PV, puestos de trabajadores, tope de descuento por cantera y efecto completo; los roles muestran acción / privilegio / momento.
- **Vista previa instantánea del Alcalde** en la carta («tú +3: barco 2 + privilegio 1»), sin pasar el cursor.
- **Estado instantáneo del Capitán / Comerciante** («barco 1 lleno / 2 vacío», «casa comercial 3/4»).
- **Avisos de las acciones de la IA** (arriba a la derecha): qué eligió cada CPU, cuánto cargó, vendió o produjo — de un vistazo.
- **Avisos de ingresos pasivos** en verde: fase del Alcalde «tú +N colonos», fase del Capataz «tú +X maíz +Y índigo», fase del Capitán «+X PV embarcados esta ronda».
- **Aviso ⚠ de última ronda**: cuando se disparan los colonos / los PV / el límite de 12 espacios, la cabecera muestra «· ⚠ última ronda» y un aviso emergente.
- **Animaciones FLIP** al tomar plantaciones / edificios.
- **Interfaz al estilo BGA**: el mercado de edificios se distribuye en 4 filas (graduadas por el descuento de cantera de 1/2/3/4 doblones).

---

## 📋 Reglas en breve

En cada ronda, empezando por el gobernador y en el sentido de las agujas del reloj, cada jugador elige **un** rol. La acción de ese rol la realizan **todos** los jugadores (sentido horario), pero **quien lo elige obtiene un privilegio adicional**. Cada carta de Rol no elegida gana +1 doblón por ronda.

| Rol | Acción | Privilegio |
|---|---|---|
| 🌾 Colono | Tomar 1 plantación | Puede tomar una cantera en su lugar |
| 👷 Alcalde | Repartir los colonos del barco uno a uno en sentido horario hasta vaciarlo | +1 colono de la reserva |
| 🏗 Constructor | Construir 1 edificio | −1 doblón de descuento |
| 🏭 Capataz | Todos producen según su capacidad | +1 de una mercancía producida esta ronda |
| 💰 Comerciante | Vender 1 mercancía en la casa comercial | +1 doblón |
| 🚢 Capitán | Cargar los barcos en orden (obligatorio), 1 mercancía = 1 PV | +1 PV (una sola vez, esta fase) |
| ⛏ Buscador de Oro | Ninguna | +1 doblón (solo quien elige) |

**Fin de la partida** (basta con un disparador → la ronda se termina y luego acaba la partida):
- No quedan suficientes colonos para llenar el barco.
- Un jugador llena sus 12 espacios de ciudad (los grandes edificios violeta ocupan 2).
- Se agota la reserva de PV.

**Puntuación**: fichas de PV + PV de los edificios + PV especiales de los grandes edificios violeta (que deben estar ocupados); los empates se deciden por doblones + mercancías.

Reglas completas: [resumen de Universal Head](https://www.universalhead.com/games/getting-rules) o [BoardGameGeek](https://boardgamegeek.com/boardgame/3076/puerto-rico).

---

## 💻 Ejecutar en local (opcional)

### Opción 1: doble clic en `index.html` (recomendado)
La estrategia de ADN y los pesos de la red neuronal del Gran Maestro están integrados como datos `<script>` — sin red, sin servidor, basta con hacer doble clic.

### Opción 2: servidor HTTP local (cómodo para modificar el código)
```bash
cd puerto-rico-web
python -m http.server 8765
# o
npx http-server -p 8765 -c-1
```
Abre [http://localhost:8765](http://localhost:8765).

---

## 📁 Estructura del proyecto

```
puerto-rico-web/
├── index.html              ← punto de entrada
├── game.js                 ← lógica completa del juego + 6 niveles de IA
├── styles.css              ← interfaz al estilo BGA
├── ai_dna.json             ← ADN evolucionado extraído del Excel (5 reservas × 10)
├── ai_dna.js               ← decodificador de ADN (Evolución / N2)
├── sim.js                  ← motor de reglas «headless» + ISMCTS (Experto / N5)
├── sim_features.js         ← extracción de 446 características (Gran Maestro / N6)
├── sim_nn.js               ← inferencia de la red neuronal (Gran Maestro / N6)
├── mcts_value_nn.json      ← pesos de AlphaZero (se cargan en línea; integrados en el zip sin conexión)
├── LICENSE                 ← MIT
├── NOTICE.md               ← nota de propiedad intelectual
├── tests/                  ← comprobaciones de conservación + autojuego de extremo a extremo + aserciones
├── tools/                  ← scripts de tasa de victorias / calibración de la escala / evaluación de entrenamiento
└── assets/
    └── buildings/          ← 23 ilustraciones de edificios (de BGG 42234)
```

---

## 🛠 Requisitos

- **Cualquier navegador moderno** (Chrome / Edge / Firefox / Safari).
- Hacer doble clic en `index.html` funciona totalmente sin conexión — **no** se necesita Python / Node.js (un servidor local solo hace falta para la recarga en caliente al editar el código).
- Resolución recomendada **1280×800+**.

---

## 🧪 Pruebas automatizadas

- **Conservación / autojuego de extremo a extremo** (Node, headless): partidas completas a 3/4/5 jugadores, comprobando que
  - la partida termina correctamente (colonos agotados / PV agotados / límite de 12 espacios),
  - los colonos se conservan (55 / 75 / 95 para 3/4/5 jugadores),
  - las mercancías se conservan (maíz 10, índigo 11, azúcar 11, tabaco 9, café 9),
  - el PV final de cada jugador > 0,
  - las mesas de niveles mixtos (N1–N6) se ordenan de forma monótona por puntuación media: N6 > N5 > N4 > N3 > N2 > N1,
  - los 23 edificios se construyen al menos una vez, y los 7 roles se eligen al menos una vez.
- **Pruebas unitarias específicas**: primer gobernador aleatorio, orden de las plantaciones iniciales, prioridad de barco por defecto del Capitán, bonificación del Capataz limitada a las mercancías producidas esta ronda, disparador de fin con ronda completa, etc.

---

## 🚢 Prioridad de barco por defecto del Capitán (nota de implementación)

Cuando una mercancía puede cargarse en varios barcos candidatos, la prioridad por defecto es:
1. **Un barco que ya transporta esa mercancía** (seguir apilando, evitar dispersar).
2. **El barco vacío con más capacidad restante.**
3. El resto de candidatos por **capacidad restante descendente**.

La lista de candidatos del jugador pone la mejor opción primero; la IA usa la misma prioridad.

---

## 📜 Créditos y fuentes

| Contribución | Fuente |
|---|---|
| **Diseño del juego original** | Andreas Seyfarth |
| **Editorial** | Rio Grande Games |
| **Evolucionador VBA (origen del ADN de la IA)** | [Tony Mitton — BGG #8766](https://boardgamegeek.com/filepage/8766/pr-030205zip) |
| **Ilustraciones de los edificios** | [Greg May — Anniversary Edition Buildings, BGG #42234](https://boardgamegeek.com/filepage/42234/base-game-and-expansion-buildings-illustrated) |
| **Referencia de reglas** | [ayuda de juego de Universal Head (PDF)](https://www.universalhead.com/games/getting-rules), [página de reglas de BGG](https://boardgamegeek.com/boardgame/3076/puerto-rico) |

---

## 📄 Licencia y atribución

- El **código** se publica bajo **licencia MIT**, ver [`LICENSE`](LICENSE).
- Esta es una **reimplementación amateur sin ánimo de lucro**. La propiedad intelectual de **Puerto Rico** (nombre, mecánicas, expresión de las reglas, etc.) pertenece a **Andreas Seyfarth / Rio Grande Games**.
- Las ilustraciones de edificios en `assets/buildings/` son propiedad de Rio Grande Games / del ilustrador original; se usan solo con fines educativos / de demostración para el juego personal y **no** están cubiertas por la licencia MIT.
- Este proyecto **no tiene afiliación oficial ni respaldo** de Andreas Seyfarth ni de Rio Grande Games.
- Consulta [`NOTICE.md`](NOTICE.md) para más detalles.
