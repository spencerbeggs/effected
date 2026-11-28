---
"@effected/shell": patch
---

## Performance

Parsing a long run of `$((` no longer keeps two objects per opener on the heap. The nested scanner now keeps the substitutions it records in a typed array, as it already did for its frame stack. A 4 MiB run of `$((` used to allocate about 64 bytes of heap per character and now allocates none. Its parse fell from about 148 ms to 96 ms of CPU, and parsed repeatedly it costs about 3.95x the CPU from one megabyte to four. A single timed parse across that span can still read higher, because it measures when the garbage collector ran. Parse results are unchanged.
