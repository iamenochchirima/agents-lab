# Agent host

The shared production-like host for Lab platform variants. It owns channel ingress and
delivery, scheduled admission, profile selection, and service operations. It dispatches
an admitted turn to a selected platform runner; it does not own that runner's agent loop
or durability semantics.

Keep hosting concerns separate from the selected platform runtime. The host uses
versioned contracts to dispatch work and collect delivery evidence.
