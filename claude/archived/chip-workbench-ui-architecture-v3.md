# CHIP Workbench UI Architecture --- v3

*Archived 2026-10-09: superseded, Mentes moved to its own repository
(tag `mentes-final`).*

## Purpose

This document revises the CHIP workbench design to incorporate the later
cross-platform and form-factor decisions.

CHIP should use one coherent conceptual workbench across:

-   Desktop;
-   Web;
-   Android.

The presentation adapts to available screen space. The architecture is
inspired structurally by VS Code, but CHIP should not copy VS Code
mechanically.

The core concepts are:

1.  Activity navigation;
2.  generic Editor Area;
3.  contextual Bottom Panel;
4.  Assistant Panel when sufficient screen space is available.

There is no permanent navigation sidebar in the baseline design.

------------------------------------------------------------------------

## 1. Core Workbench

On sufficiently large displays:

``` mermaid
flowchart LR
    A["Activity Navigation"]

    subgraph M["Main Workbench"]
        direction TB
        E["Tabbed Editor Area"]
        P["Tabbed Bottom Panel"]
    end

    AI["Assistant Panel"]

    A --> M
    M --> AI
```

Major regions should be resizable where appropriate. Auxiliary regions
should be hideable/collapsible.

------------------------------------------------------------------------

## 2. No Permanent Navigation Sidebar

The Primary Side Bar proposed in the earliest CHIP design is removed.

Database and game navigation do not require a permanently visible tree.
A game database or game list can itself be an editor/view in the Editor
Area.

For example:

``` text
Games | Kasparov–Karpov | Analysis Board | Player
```

This establishes an important rule:

> Navigation content may itself be an editor/view. Do not add a
> permanent navigation sidebar unless a concrete workflow later
> demonstrates that one is needed.

------------------------------------------------------------------------

## 3. Activity Navigation

On large displays, activity navigation is a narrow icon-oriented bar at
the side.

An activity does not necessarily open a sidebar. It may activate, focus,
or open an editor/view.

The exact activities should emerge from real CHIP workflows rather than
being invented to populate the bar.

On smartphone layouts, these activity icons move to bottom navigation.

------------------------------------------------------------------------

## 4. Generic Editor Area

The Editor Area is generic and tabbed on large displays.

A **board is an editor type**, not the Editor Area itself.

The architecture must permit:

-   multiple editor types;
-   multiple instances of the same editor type;
-   opening and closing editors;
-   an active editor;
-   contextual capabilities exposed by each editor.

Possible editor types include:

-   Game Database / Game List editor;
-   Board editor;
-   Player editor;
-   Opening/tree editor;
-   other future chess-oriented editors.

Only implement editor types required by concrete scope.

------------------------------------------------------------------------

## 5. Game Database / Game List Editor

The game database/list is represented directly in the Editor Area.

It may support database browsing, filtering, selection, and opening
games.

Opening a game creates or activates a Board editor.

``` mermaid
flowchart LR
    G["Games Editor"] --> O["Select / Open Game"]
    O --> B["Board Editor"]
```

This editor supplies the navigation function that might otherwise have
required a permanent left panel.

------------------------------------------------------------------------

## 6. Board Editor

The Board editor represents an interactive chess game or position.

The editor owns the current game/position state. Other components
observe or operate on that state.

``` mermaid
flowchart LR
    E["Active Board Editor"] --> G["Current game"]
    E --> P["Current position"]
    E --> M["Current move / selection"]

    G --> BP["Contextual tools"]
    P --> BP
    M --> BP
```

Multiple Board editors must be possible simultaneously on
platforms/layouts that support multiple open editors.

------------------------------------------------------------------------

## 7. Bottom Panel

On large displays, the Bottom Panel appears below the Editor Area.

It is tabbed and contains contextual views, tools, and output associated
with the active editor.

Initial important tabs are:

``` text
PGN | Stockfish
```

### PGN

The PGN tab presents the game representation associated with the active
Board editor.

It may expose:

-   headers;
-   moves;
-   comments;
-   variations;
-   NAGs.

The detailed PGN editing model is a separate design question.

### Stockfish

The Stockfish tab presents engine analysis for the active position.

It may expose:

-   evaluation;
-   depth;
-   principal variations;
-   engine controls.

Detailed engine integration is outside this workbench design.

### Future contextual tabs

Other tabs may be introduced when concrete requirements justify them,
for example:

-   Game Info;
-   Opening;
-   Position;
-   References;
-   search results;
-   import/database-operation output.

Do not implement speculative tabs merely to fill space.

------------------------------------------------------------------------

## 8. Editor Context and Panel Applicability

The active editor exposes contextual capabilities.

A Board editor may expose a game and position, making PGN and Stockfish
applicable.

A Game List editor may expose selected games, a result set, or database
context.

Consumers must not assume every editor is a Board editor.

``` mermaid
flowchart TB
    E["Active Editor"] --> C["Exposed Context / Capabilities"]
    C --> P["Applicable Contextual Views"]
```

A tool that is not applicable to the active editor may become inactive
or show an appropriate empty state.

------------------------------------------------------------------------

## 9. Assistant Panel

CHIP includes a conversational Assistant Panel when sufficient screen
space is available.

The Assistant Panel should be contextual: it can interact with CHIP
capabilities and reason about the active editor through the MCP
interface.

The workbench architecture must not be coupled to a specific commercial
LLM provider.

During development, a local **Qwen 8B** model is a useful configuration.
It is not a permanent architectural requirement.

Possible future configurations may include local or public/cloud LLMs.

------------------------------------------------------------------------

## 10. CHIP MCP Server

CHIP exposes its chess capabilities through an MCP server.

This provides a common integration surface for:

1.  CHIP's built-in assistant;
2.  external MCP-capable AI hosts.

``` mermaid
flowchart TB
    CORE["CHIP application/core capabilities"] --> MCP["CHIP MCP Server"]
    EXT["External MCP Host"] --> MCP
    LOCAL["CHIP Built-in Assistant"] --> MCP
```

The MCP surface should be designed incrementally from concrete use cases
rather than as a speculative complete chess API.

Possible capabilities include obtaining the active position, reading a
game, searching games, or performing chess operations.

------------------------------------------------------------------------

## 11. Small MCP Client

The built-in assistant uses a **small MCP client**.

Keep it deliberately small.

Do not turn it into:

-   a general agent framework;
-   a general orchestration platform;
-   an elaborate provider abstraction;
-   a complex autonomous agent.

``` mermaid
flowchart LR
    UI["CHIP Assistant Panel"] --> C["Small MCP Client"]
    C --> LLM["Configured LLM"]
    C --> M["CHIP MCP Server"]
```

The client needs only enough machinery to support the configured LLM and
the basic model/tool interaction required by CHIP.

It may need to:

-   maintain the conversation required by the UI;
-   expose relevant MCP tools to the model;
-   recognize tool requests;
-   invoke corresponding MCP tools;
-   return tool results;
-   present or stream assistant output.

------------------------------------------------------------------------

## 12. Basic Assistant Interaction

``` mermaid
sequenceDiagram
    participant U as User
    participant P as CHIP Assistant Panel
    participant C as Small MCP Client
    participant L as Configured LLM
    participant M as CHIP MCP Server

    U->>P: Ask a chess question
    P->>C: User message
    C->>L: Prompt + available tools
    L-->>C: Response or tool request

    alt Tool requested
        C->>M: MCP tool invocation
        M-->>C: Tool result
        C->>L: Tool result
        L-->>C: Continued/final response
    end

    C-->>P: Assistant response
```

This is a minimal interaction loop, not a requirement for generalized
autonomous orchestration.

------------------------------------------------------------------------

## 13. Desktop and Wide Web Layout

Desktop and sufficiently wide Web layouts use the full workbench:

``` mermaid
flowchart LR
    A["Activity Icons"]

    subgraph M["Main"]
        direction TB
        E["Tabbed Editor Area"]
        P["Tabbed Context / Output Panel"]
    end

    AI["Assistant Panel"]

    A --> M
    M --> AI
```

The editor and Bottom Panel should be vertically resizable.

The Assistant Panel should be horizontally resizable and hideable.

------------------------------------------------------------------------

## 14. Android and Narrow-Screen Navigation

On smartphone layouts, side activity icons become **bottom navigation
icons**.

``` mermaid
flowchart TB
    C["Main Content"]
    N["Bottom Activity Navigation"]
    N --> C
```

The logical activities remain aligned with the large-screen workbench.
Only their presentation changes.

This is not a separate CHIP information architecture.

------------------------------------------------------------------------

## 15. Editor and Bottom Panel on Smartphones

A smartphone cannot usefully show the large-screen editor-above-panel
arrangement at the same time.

Therefore the Editor Area and Bottom Panel become mutually exclusive
main-area views.

``` mermaid
flowchart TB
    C["Main Area<br/>Editor OR Context / Output"]
    N["Bottom Navigation"]
    N --> C
```

For example, a user may move between:

``` text
Board -> PGN -> Board -> Stockfish -> Board
```

without closing the game or losing the current position.

Switching views changes presentation only. State must be preserved.

------------------------------------------------------------------------

## 16. Assistant Space Constraint

Conversational AI has a stronger screen-space requirement than PGN or
Stockfish.

Useful interaction requires simultaneous visibility of:

1.  the chessboard or other working editor;
2.  LLM conversation/output;
3.  the prompt/input area;
4.  while typing, the software keyboard.

On a smartphone-sized display, these cannot all remain useful
simultaneously.

Making the Assistant a full-screen replacement is also inadequate
because the user would lose sight of the board or other object being
discussed.

Therefore integrated Assistant availability is a **form-factor
constraint**, not an operating-system constraint.

------------------------------------------------------------------------

## 17. Responsive Assistant Availability

The rule is:

> **Enable the integrated Assistant only when the available layout can
> keep the active working editor and conversational interaction
> simultaneously usable.**

``` mermaid
flowchart TD
    S["Available Window Space"] --> Q{"Enough space for<br/>editor + conversation?"}
    Q -->|Yes| A["Assistant available"]
    Q -->|No| N["Assistant hidden / unavailable"]
```

Consequences:

-   Desktop normally supports the Assistant.
-   Wide Web layouts normally support the Assistant.
-   Smartphone layouts normally do not.
-   A sufficiently large Android tablet may support it.
-   A narrow Desktop/Web window may temporarily omit it.

Do not implement this as a simple `platform == Android` rule.

------------------------------------------------------------------------

## 18. Responsive Platform Mapping

  -----------------------------------------------------------------------
  Concept           Large Desktop/Web Smartphone        Large Tablet
  ----------------- ----------------- ----------------- -----------------
  Activity          Side icons        Bottom icons      Responsive
  navigation                                            

  Game              Editor/view       Full main view    Editor/view
  list/database                                         

  Board             Editor tab        Full main view    Editor/view

  PGN/Stockfish     Bottom Panel      Full main view    Responsive
                                      replacing editor  

  Assistant         Right panel       Normally          Available when
                                      unavailable       space permits
  -----------------------------------------------------------------------

These are presentation differences, not different CHIP semantics.

------------------------------------------------------------------------

## 19. Shared State Model

Responsive layout changes must not alter application-state semantics.

Relevant state may include:

-   open editors;
-   active editor;
-   open games;
-   current game position;
-   selected contextual panel tab;
-   Stockfish state;
-   assistant conversation where supported.

Large displays may expose several surfaces simultaneously.

Small displays may expose only one main surface at a time.

State must survive view changes and responsive layout transitions.

------------------------------------------------------------------------

## 20. Architectural Commitments

1.  CHIP uses a workbench-style UI architecture.
2.  Desktop, Web, and Android share the same conceptual model.
3.  Layout adapts to form factor.
4.  There is no permanent navigation sidebar in the baseline design.
5.  Game/database navigation can be represented as an editor/view.
6.  The Editor Area is generic.
7.  A Board is an editor type.
8.  Multiple editor types and instances are supported conceptually.
9.  The active editor exposes contextual capabilities.
10. PGN and Stockfish are initial important contextual views.
11. On large screens, contextual views appear in a Bottom Panel.
12. On smartphones, the editor and contextual panel occupy the main area
    one at a time.
13. Smartphone activity navigation uses bottom icons.
14. View switching preserves editor/game/tool state.
15. CHIP exposes an MCP server.
16. The built-in assistant uses a small MCP client.
17. The Assistant uses a configurable LLM.
18. Local Qwen 8B is a development configuration, not an architectural
    requirement.
19. External MCP-capable AI hosts may use the same CHIP MCP server.
20. Assistant availability is based on usable display space, not
    platform identity.
21. Smartphone layouts normally omit integrated AI because the board,
    conversation, prompt, and keyboard cannot all remain usefully
    visible.
22. Large Android devices may support the same Assistant interaction as
    Desktop/Web.
23. Do not build a general agent/orchestration framework.
24. Do not implement speculative functionality merely to populate
    workbench regions.

------------------------------------------------------------------------

## 21. Implementation Guidance for Claude

Before making structural changes:

1.  inspect the existing CHIP application architecture;
2.  identify existing navigation, game, board, engine, and UI state;
3.  preserve reusable abstractions;
4.  avoid unnecessary refactoring;
5.  separate logical workbench state from responsive presentation.

Prefer reusable concepts such as:

-   editor descriptors/types;
-   open editor instances;
-   active editor;
-   editor capabilities/context;
-   contextual panel state;
-   responsive workbench layout state;
-   Assistant visibility based on available dimensions.

Do not make UI behavior depend unnecessarily on a specific platform when
a responsive size class expresses the actual constraint.

------------------------------------------------------------------------

## 22. Explicit Non-Goals

Do not expand this design into:

-   a permanent navigation sidebar without demonstrated need;
-   identical pixel-level layouts across platforms;
-   forcing Desktop panels onto smartphone screens;
-   forcing integrated AI onto smartphones merely for feature parity;
-   disabling AI categorically on all Android devices;
-   a particular commercial LLM provider;
-   a generic LLM-provider framework;
-   a generic agent framework;
-   a complete MCP chess API designed in advance;
-   every possible editor type;
-   every possible contextual panel tab;
-   advanced chess intelligence unrelated to the workbench architecture.

The objective is one coherent CHIP workbench that scales from
Desktop/Web to Android while preserving the central model of generic
editors, contextual chess tools, and optional MCP-enabled conversational
assistance.
