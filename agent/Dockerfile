FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies (if any)
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose the port used by FastAPI (Render provides $PORT env var)
ENV PORT=8000

# Start the FastAPI app using uvicorn
CMD ["uvicorn", "app.__init__:app", "--host", "0.0.0.0", "--port", "${PORT}"]
