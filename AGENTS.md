# Settlement-triggered Activity Publication Cell

This cell owns one capability: advancing one durable ActivityPub pulse from one
independently assayed final TypedCommitment on the EVM CAIP-2 chain selected by
its deployment.

It must hire finality observation and ActivityPub transport. It must not expose
RPC, assay finality, own another actor's keys, sign customer transactions, or
use wall-clock time in the identity or causal order of a pulse.

The earlier instruction fixed the capability law to `eip155:5615610`. That was
superseded because a chain is a typed deployment/offer binding, not part of the
generic publication capability. The 561 Group deployment still binds
`eip155:5615610`.
