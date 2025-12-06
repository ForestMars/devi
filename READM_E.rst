.. image:: assets/multipass.png
   :alt: Setup Status

******
Setup
******

This document outlines the steps required to set up the project both locally and for integration with GitHub.
This project, `ForestMars/pedal-dev`, operates as a PR review agent powered by Ollama.



---

.. _local-setup:

Local Setup
===========

Follow these steps to configure your local environment and receive webhooks via **smee**.

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

6.  **Setup Smee.io for Local Tunneling**
    To receive webhooks (like those from Render.com or GitHub) on your local machine, you must use a tunneling service.

    * **Install Smee Client:**
        .. code-block:: bash

            npm install --global smee-client

    * **Get a Smee Channel URL:**
        Go to **https://smee.io/** and click **"Start a new channel"** to get a unique URL (e.g., ``https://smee.io/aBcDeF12345``).

    * **Run Smee Client:**
        Forward the webhook payloads from the Smee URL to your local server (running on port 3000):
        .. code-block:: bash

            smee -u YOUR_SMEE_URL -t http://localhost:3000/api/webhook/github

        .. important::
            * Replace ``YOUR_SMEE_URL`` with the unique URL you obtained from smee.io.
            * **Crucially:** You must configure the webhook URL in **GitHub** (via your Render.com settings) to use this **Smee URL** instead of your local IP address.

---

.. _github-setup:

GitHub Setup
============

This section covers the necessary configurations for GitHub integration.

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

---

.. _testing:

Testing
=======

Use these ``curl`` commands to test the local server endpoints after starting the application and completing all setup steps.

Test Webhook Endpoint
---------------------

This command simulates a **Pull Request Opened** event being sent to your local webhook listener:

.. code-block
