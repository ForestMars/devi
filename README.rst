.. image:: https://img.shields.io/badge/Setup-Complete-brightgreen
   :alt: Setup Status

******
Setup
******

This document outlines the steps required to set up the project both locally and for integration with GitHub.

---

.. _local-setup:

Local Setup
===========

Follow these steps to configure your local environment:

1.  **Install Bun:**
    .. code-block:: bash

        curl -fsSL https://bun.sh/install | bash

2.  **Install Ollama:**
    .. code-block:: bash

        curl -fsSL https://ollama.com/install.sh | sh

3.  **Pull a model (e.g., Code Llama):**
    .. code-block:: bash

        ollama pull codellama

4.  **Project Setup:**
    * Clone or create your project directory.
    * Run the project dependencies installation:
        .. code-block:: bash

            bun install

5.  **Environment File:**
    * Create a ``.env`` file in the root directory. (Refer to project documentation for contents.)

---

.. _github-setup:

GitHub Setup
============

This section covers the necessary configurations for GitHub integration, including setting up a Personal Access Token and a Webhook Secret.

Personal Access Token
---------------------

The Personal Access Token (PAT) is required for API access.

1.  Go to **GitHub** → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**.
2.  Click **Generate new token**.
3.  Select the following scopes:
    * ``repo`` (all)
    * ``write:discussion``
4.  **Copy the token** and paste it into the project's ``.auth`` file as ``GITHUB_TOKEN``.

Generate Webhook Secret
-----------------------

A Webhook Secret is used to secure the payload sent from GitHub.

1.  Generate a 32-character hexadecimal secret using the following command:
    .. code-block:: bash

        openssl rand -hex 32

2.  **Copy the output** and paste it into your ``.env`` file as ``GITHUB_WEBHOOK_SECRET``.
