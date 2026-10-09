# CHIP Wishlist

*Archived 2026-10-09: superseded, Mentes moved to its own repository
(tag `mentes-final`).*

## Purpose

`chip` is the working repository name for a **Chess Intelligence Platform**.

The long-term idea is to treat **chess games as analyzable documents**: import games, derive structured chess information from them, search and compare that information, and eventually let users ask higher-level questions about collections of games.

CHIP should begin much more simply, however: as a lightweight, modern chess database application with no intelligence at all.

The product should remain useful as a standalone local application, while leaving room for future expansion if infrastructure, investment, or organizational support becomes available.

## Product Principle

CHIP should earn the right to become intelligent.

The initial product should be useful even if development stops before any AI or advanced intelligence is added.

The conceptual progression is:

> **Chess database → engine workstation → personal analytics → structured chess intelligence → collection intelligence → assistant**

---


# Platform Strategy

CHIP should be developed from the beginning as a **Kotlin Compose Multiplatform product for Desktop/Windows, Android, and Web**.

Feature parity should be the default goal across all three targets. Platform differences should primarily concern presentation, persistence, file access, and resource constraints rather than product capability.

## Windows / Desktop
- Full local chess database support.
- Support CHIP-hosted synchronized cloud databases in addition to purely local databases.
- Natural environment for large collections, multi-pane layouts, keyboard-heavy workflows, and long analysis sessions.
- A user should be able to work entirely locally or connect selected databases to the cloud.

## Android
- Same product capabilities as Desktop.
- Support both local databases and CHIP-hosted synchronized cloud databases.
- UI adapts to smaller screens rather than removing features.
- Practical limits may differ because of screen space, memory, and disk space.
- A user should be able to continue working locally when cloud synchronization is unavailable.

## Web
- Same core CHIP capabilities as Desktop and Android.
- Use a CHIP-hosted cloud database as the durable source of truth.
- Do not use browser-local persistence such as IndexedDB as the authoritative database.
- Browser-local storage, where used, should be treated only as cache or disposable state.
- Web therefore requires a minimal backend from the beginning.

## Shared Product Principle

> **One CHIP product, three first-class targets, one shared feature roadmap.**

The implementation may differ where platforms require it, but features should not be arbitrarily restricted by platform.

The platform persistence model is:

> **Windows/Android → local databases and optionally synchronized CHIP cloud databases**  
> **Web → CHIP cloud databases**

Cloud synchronization should extend the local product rather than replace local ownership on Desktop and Android.

Infrastructure should remain as thin as possible initially and expand only when product needs justify it.



# Cloud Database Product Model

CHIP should take inspiration from products such as OneDrive and Google Drive, but **CHIP itself should provide the chess-database cloud service**. This is not a plan to integrate with OneDrive or Google Drive as the primary storage mechanism.

The core idea is:

> **Your chess databases, available everywhere, synchronized, versioned, and safe.**

CHIP databases may be:

- local-only;
- cloud-hosted;
- local with a synchronized cloud copy.

Desktop/Windows and Android should support local databases and synchronized cloud databases. Web should work directly with cloud-hosted CHIP databases.

The cloud service should eventually provide:
- database synchronization across devices;
- offline work on Desktop and Android followed by synchronization;
- conflict detection and resolution;
- version history;
- backup and recovery;
- database sharing;
- permissions and collaboration where useful;
- access to the same databases from Desktop, Android, and Web.

PGN should remain an important import/export and interchange format, but CHIP should not be limited to treating PGN files as its primary persistence model. A CHIP database may contain richer information such as annotations, indexes, engine analysis, derived intelligence, metadata, and version history.

The cloud layer should have value even before advanced chess intelligence exists.

A simple early product proposition is:

> **Your chess database on your PC, phone, and browser, always synchronized.**

Later, CHIP intelligence strengthens that proposition:

> **Your chess databases, available everywhere — and understood by CHIP.**


# Roadmap Wishlist

## CHIP 0.1 — Light Chess Database

The first milestone should be a small, modern SCID-like application available from the start on **Desktop/Windows, Android, and Web**.

The same core workflow should exist on all three targets. Desktop and Android support local databases from the start and should be designed to support synchronized cloud databases; Web uses the minimal hosted persistence layer required by its cloud database.

Wishlist:
- local chess game database;
- PGN import and export;
- game list;
- chessboard and move navigation;
- variations;
- comments and NAGs;
- edit game metadata;
- basic filtering by player, event, date, result, ECO, and opening;
- position/FEN input;
- save edited games;
- basic database browsing and organization.

No AI.  
No intelligence layer.  
No cloud requirement.  
No accounts.  
No social or playing platform.

The goal is:

> **CHIP can replace a basic PGN viewer/database for personal use.**

## CHIP 0.2 — Serious Database Usability

Improve the classical chess-database experience.

Wishlist:
- multiple databases;
- larger game collections;
- fast indexing and filtering;
- duplicate detection;
- position search;
- opening tree;
- game-copy and move operations between databases;
- improved annotation and variation editing;
- database statistics;
- configurable board and UI preferences;
- PGN validation and cleanup;
- better import/export workflows.

Still no intelligence layer.

## CHIP 0.3 — Engine Workstation

Add conventional chess-engine functionality.

Wishlist:
- Stockfish integration;
- evaluation display;
- principal variations;
- analyze current position;
- analyze complete game;
- configurable engine settings;
- configurable analysis time/depth;
- save engine annotations;
- batch analysis;
- identify key evaluation swings.

This remains classical chess software rather than CHIP's distinguishing intelligence layer.

## CHIP 0.4 — Personal Chess Database

Start deriving useful information from collections without introducing AI-heavy features.

Wishlist:
- import personal Chess.com/Lichess game archives;
- player profiles derived from the local database;
- opening performance statistics;
- opponent history;
- results by color, period, opening, event, or other metadata;
- recurring positions;
- repertoire-oriented views;
- performance trends;
- frequently played openings and structures;
- basic historical comparisons.

## CHIP 1.0 — First Structured Intelligence

This is where the name Chess Intelligence Platform begins to matter.

Wishlist:
- pawn-structure classification;
- opening and variation classification;
- middlegame type classification;
- endgame type classification;
- critical-position detection;
- tactical motif detection;
- strategic motif detection;
- recurring mistake categories;
- material-imbalance classification;
- position characteristics;
- structured game-level analysis stored alongside the game.

The important conceptual jump is:

> **A game becomes more than PGN plus engine evaluations: it acquires structured derived chess knowledge.**

## CHIP 1.x — Collection Intelligence

Apply structured intelligence across many games.

Wishlist:
- search using derived chess concepts;
- aggregate intelligence across a collection;
- identify recurring strengths and weaknesses;
- recurring tactical and strategic patterns;
- repertoire intelligence;
- opponent intelligence;
- trends over time;
- intelligent dashboards;
- compare players, collections, or periods;
- drill from aggregate statistics into specific games and positions.

Examples of future queries:
- show my losses from isolated-queen-pawn positions;
- find games where I entered an equal rook ending and later lost;
- show recurring mistakes after leaving my repertoire;
- compare my handling of opposite-side castling positions across different periods.

## CHIP 2.0 — Chess Knowledge Assistant

Only after the database, analysis, and structured-intelligence layers are mature.

Wishlist:
- natural-language search over the local database;
- questions over collections of analyzed games;
- explanations grounded in actual games and positions;
- automatically find illustrative examples;
- generate study collections;
- summarize recurring patterns;
- compare periods of a player's development;
- cross-game reasoning;
- assistant-driven navigation of large chess collections.

The assistant should sit on top of structured chess intelligence rather than replace it.

---

# Feature Wishlist

## Game Library
- import and organize PGN games;
- browse games by player, event, date, result, opening, or metadata;
- maintain personal and external collections;
- search and filter large collections;
- support multiple local databases.

## Game Analysis
- analyze complete games, not only isolated positions;
- identify key moments and turning points;
- detect tactical and strategic mistakes;
- record evaluations and move-quality information;
- summarize the overall character of a game.

## Chess Classification
- classify openings and variations;
- classify pawn structures;
- classify middlegame and endgame types;
- identify tactical and strategic motifs;
- tag games by recurring themes;
- classify material imbalances and positional characteristics.

## Position Intelligence
- find repeated positions across games;
- detect transpositions;
- search by exact position;
- search by position characteristics;
- track how particular structures or positions were handled historically;
- relate similar positions across different games.

## Player Intelligence
- analyze personal strengths and weaknesses;
- detect recurring mistakes and successful patterns;
- compare performance across openings, structures, and game phases;
- track how a player's chess changes over time;
- compare different periods of a player's history.

## Repertoire Intelligence
- compare played games with a repertoire;
- detect where a player left known repertoire;
- find frequently occurring missing lines;
- identify repertoire conflicts and transpositions;
- highlight areas deserving review;
- compare repertoire versions.

## Opponent Intelligence
- summarize an opponent's opening preferences;
- identify recurring structures, habits, and tendencies;
- find relevant historical games quickly;
- support lightweight opponent preparation;
- compare recent and historical tendencies.

## Search and Exploration
- search games by chess meaning, not only PGN headers;
- combine criteria such as opening, structure, result, position, motif, player, or period;
- explore related games and positions;
- surface recurring or unusual patterns;
- drill from statistics into concrete examples.

## Training Support
- turn recurring mistakes into review material;
- generate position sets from personal games;
- build training collections around openings, structures, motifs, or endgames;
- focus training on weaknesses detected from actual play;
- generate study material from selected game collections.

## PGN Tools
- validate and repair PGN files;
- compare two PGN or repertoire versions;
- merge compatible game trees and annotations;
- detect duplicates;
- normalize inconsistent metadata;
- export cleaned or enriched PGN data.

## Reporting and Visualization
- concise game summaries;
- player summaries;
- trends over time;
- opening distributions;
- structure distributions;
- result distributions;
- mistake-pattern distributions;
- repertoire coverage views;
- reports suitable for players or coaches.

---

# Infrastructure Growth

CHIP should keep infrastructure minimal, but its own cloud database service is part of the product direction from the beginning because Web depends on it and Desktop/Android should be able to synchronize with it.

The initial infrastructure can remain deliberately small: durable cloud databases, synchronization, authentication/entitlements where required, and the minimum services needed by the Web client.

If the product later gains investment or organizational support, possible extensions include:

- richer synchronization and conflict management;
- database version history and recovery;
- database sharing and permissions;
- shared coach/student libraries;
- large hosted public or private game databases;
- remote engine analysis;
- shared repertoires;
- collaborative annotation;
- automatic game ingestion from chess platforms;
- server-side intelligence processing;
- organization or club features;
- shared dashboards.

These should expand a useful core product rather than rescue an application that cannot work without them.

---

# Positioning

CHIP should not begin as:
- another chess server;
- another social chess platform;
- another generic Stockfish GUI;
- another generic AI coach;
- another puzzle application.

Its long-term distinguishing idea is:

> **Turn chess games into structured chess intelligence that can be searched, compared, analyzed, aggregated, and eventually questioned.**

Its short-term product identity is much simpler:

> **Build a modern lightweight chess database first, make its databases available everywhere, then make them intelligent.**

A useful product metaphor is:

> **OneDrive/Google Drive for chess databases — as inspiration for the experience, not as storage integrations.**
