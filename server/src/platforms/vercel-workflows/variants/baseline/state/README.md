# state

Owns Lab-side admission state. A pending reservation is retained when the process
cannot prove whether Workflow accepted the native run, preventing an unsafe duplicate
submission on retry.
