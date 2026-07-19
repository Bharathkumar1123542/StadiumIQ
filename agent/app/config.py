"""Shared config and constants for the agent."""
import os

NEXT_BASE_URL = os.getenv("NEXT_BASE_URL", "http://localhost:3000")

VENUES: dict[str, dict] = {
    "metlife":  {"name": "MetLife Stadium",     "city": "East Rutherford", "capacity": 82500},
    "sofi":     {"name": "SoFi Stadium",         "city": "Los Angeles",     "capacity": 70240},
    "atandt":   {"name": "AT&T Stadium",         "city": "Arlington",       "capacity": 80000},
    "azteca":   {"name": "Estadio Azteca",       "city": "Mexico City",     "capacity": 87500},
    "bcplace":  {"name": "BC Place",             "city": "Vancouver",       "capacity": 54500},
}
