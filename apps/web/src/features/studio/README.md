# Studio prototype

This feature is a throwaway UI prototype for the proposed standalone Studio system.

Open `/studio` to inspect three local-only views:

- `?variant=command` — Studio command center
- `?variant=focus` — Context Management inside Studio
- `?variant=map` — complete agent execution path

The prototype does not call a server, persist configuration, create runs, or display benchmark data. Its purpose is to settle the shape of one Studio interface before the system is implemented.

The Context focus view keeps the main Studio sidebar and a compact component-area
rail for moving between the eleven harness areas. The environment inspector was
removed so the experiment controls remain the visual centre of the page. The view
only shows the currently supported old-important-fact case; unsupported scenarios
are not presented as selectable controls.
