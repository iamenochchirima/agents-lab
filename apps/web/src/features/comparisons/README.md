# Comparisons

`CompareRunModal.tsx` builds a shared workload configuration for multiple platform
implementations. It selects at least two platforms plus a scenario, model settings, and
experiment. It does not require identical deployment details: each platform keeps its
own backend profile and infrastructure requirements.

The modal keeps each implementation's server configuration local. It does
not flatten those concerns into an artificial common runtime or display a comparison
result before real runs exist.
