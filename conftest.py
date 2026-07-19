"""
Pytest configuration — adds the agent directory to sys.path so that
``from app.orchestrator import ...`` resolves correctly without installing the package.
"""
import sys
from pathlib import Path

# Add /agent to the path so test imports work as: from app.module import ...
sys.path.insert(0, str(Path(__file__).parent / "agent"))
