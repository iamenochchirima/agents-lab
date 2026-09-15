# runtime

Owns the Activity worker loop: long-poll for a task token, execute the model adapter,
and report success or failure. A lost completion response is left for Step Functions
to reconcile; the worker does not blindly repeat a model call with the same token.
