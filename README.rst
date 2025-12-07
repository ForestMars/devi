pedal-dev
=========

.. image:: ./assets/multipass.png
   :alt: Multipass

**Now with MULTIPASS!**

A GitHub App for product engineering design automation lifecycle. 

Companion app to `pedal-pro <https://github.com/ForestMars/PEDAL>`_, the automated pipeline. Provides automated code review using LLM providers, reviewing pull requests and posting inline comments with actionable feedback.

Agents
------

pedal-dev provisions 6 automation agents across the product engineering lifecycle:

1. **prd-agent** - Reviews product requirements documents
2. **refinement** - Reviews product requests (GitHub tickets), accepts into sprint or returns with questions
3. **pr-review** - Automated code review on pull requests (first working implementation, currently A/B testing prompts)
4. **auto-fix-pr** - Responds to issues identified by pr-review agent
5. *[TBD]*
6. *[TBD]*

Features
--------

- Multi-pass review with configurable merge strategies
- Batch processing for large changesets
- Configurable file filtering and ignore patterns
- Support for multiple LLM providers
- Inline code comments on specific lines
- Summary comments when no issues found

Configuration
-------------

Environment Variables
~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   # LLM Provider
   LLM_PROVIDER=anthropic           # anthropic, openai, etc.
   ANTHROPIC_API_KEY=sk-ant-...
   MODEL_NAME=claude-sonnet-4-20250514

   # File Filtering
   FILTER_LARGE_FILES=yes           # Enable strict filtering
   MAX_FILE_CHANGES=800             # Skip files exceeding this threshold
   MAX_FILES=15                     # Review at most this many files

   # Multi-pass Review (optional)
   PR_REVIEW_MULTIPASS=true         # Enable multi-pass mode
   PR_REVIEW_PASSES=3               # Number of passes (default: 1)
   PR_REVIEW_MERGE_STRATEGY=union   # union|intersection|majority

Ignore Patterns
~~~~~~~~~~~~~~~

Configure ignored files in ``config/ignore-files.txt``::

   \.gitignore$
   \.lock$
   package-lock\.json$
   \.min\.(js|css)$
   \.map$
   dist/
   node_modules/
   \.md$
   \.yml$

Patterns are treated as regular expressions.

Review Prompt
~~~~~~~~~~~~~

Customize the review prompt in ``config/prompts/pr-review.md`` or via the agent configuration system.

Multi-pass Review
-----------------

Multi-pass mode runs the review multiple times and merges findings based on the configured strategy:

- **union**: All findings from all passes (deduplicated)
- **intersection**: Only findings present in every pass
- **majority**: Findings present in >50% of passes

This reduces false positives and increases confidence in reported issues.

Installation
------------

1. Clone the repository
2. Install dependencies: ``npm install`` or ``bun install``
3. Configure environment variables
4. Set up GitHub App credentials
5. Deploy and configure webhook

Development
-----------

.. code-block:: bash

   # Install dependencies
   bun install

   # Run locally
   bun run dev

   # Build
   bun run build

Architecture
------------

- **ReviewEngine**: Orchestrates the review process
- **ReviewEngineCore**: Handles comment posting and formatting
- **LLMProvider**: Abstract interface for LLM interactions
- **ConfigLoader**: Manages configuration and ignore patterns

License
-------

All Rights Reserved
Contact for Licensing
