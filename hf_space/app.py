import os
import sys

# Ensure current directory is in Python module path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

import gradio as gr
import uvicorn
from app.main import app as fastapi_app

# Modern Gradio status page for the root domain
with gr.Blocks(title="FurnForge AI — Backend Service") as demo:
    gr.Markdown("# 🛋️ FurnForge AI — Generative Vision & 3D Backend")
    gr.Markdown(
        """
        ### Generative Vision & 3D Neural Reconstruction API
        This Hugging Face Space powers the **FurnForge AI** client application on Vercel.
        
        - **Status:** Active & Ready
        - **API Documentation:** [Swagger UI](/docs) | [ReDoc](/redoc)
        - **Health Check:** [/api/health](/api/health)
        """
    )

# Mount Gradio onto the existing FastAPI app
app = gr.mount_gradio_app(fastapi_app, demo, path="/")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
