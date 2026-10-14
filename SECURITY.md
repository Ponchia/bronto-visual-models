# Security

This library is not an authorization server or an executable-plugin sandbox.
Family callbacks and host adapters are trusted code. Model data must be JSON and
must not grant network, filesystem or application permissions by naming a source.

Report suspected vulnerabilities privately through GitHub's private vulnerability
reporting for this repository. Do not post credentials or exploit-bearing user data
in a public issue. The current supported line is the latest 0.1.0 beta release.

Rendering engines retain their own security boundaries. The reference views use
fixed grammars and plain text labels, make no implicit data requests and do not
execute arbitrary source code. Other host-provided renderers need their own
sanitization and access policy.

Local file stores are cooperative single-host stores. An unknown lock or uncertain
commit is a refusal/recovery situation, not permission to steal the lock or repeat
the write under a new key. See [storage](docs/storage.md).
