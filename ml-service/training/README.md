# training

Offline training pipelines. Nothing here is imported by the serving app — the
service only ever reads the artifacts these scripts produce.

A run should end by writing a new version directory under `../models/<type>/`
and, once validated, updating that type's `active_version.json`.
