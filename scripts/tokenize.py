#!/usr/bin/env python3
"""Tokenizer service: reads strings line-by-line (base64-encoded) from stdin,
prints token count per line using cl100k_base. EOF terminates."""
import sys
import base64
import tiktoken

enc = tiktoken.get_encoding("cl100k_base")
for line in sys.stdin:
    line = line.rstrip("\n")
    if not line:
        print(0)
        continue
    s = base64.b64decode(line).decode("utf-8", errors="replace")
    print(len(enc.encode(s)))