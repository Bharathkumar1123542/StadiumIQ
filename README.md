# StadiumIQ

StadiumIQ is a modern web application consisting of a Next.js frontend and a Python/FastAPI backend agent.

## Project Structure

- `/`: Next.js frontend application (React, TypeScript, Vercel).
- `/agent`: Python FastAPI backend service and orchestration logic.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Python](https://www.python.org/) (v3.9 or higher)

## Getting Started

### Frontend (Next.js)

The frontend is built with Next.js and uses `next/font` for optimized loading of the Geist font family.

To start the frontend development server:

```bash
# Install dependencies (if not already done)
npm install

# Start the development server
npm run dev
# or yarn dev, pnpm dev, bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Backend (Python/FastAPI)

The backend agent is an API built with FastAPI. It handles the orchestration logic.

To start the backend development server:

```bash
cd agent

# Create a virtual environment and activate it
python -m venv venv
# On Windows: venv\Scripts\activate
# On Unix or MacOS: source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the uvicorn server
uvicorn agent.main:app --reload --port 8000
```

The API will be available at [http://localhost:8000](http://localhost:8000). You can access the automatic interactive API documentation at [http://localhost:8000/docs](http://localhost:8000/docs).

## Deployment

- **Frontend:** The frontend is configured for deployment on [Vercel](https://vercel.com).
- **Backend:** The backend is configured for deployment on [Google Cloud Run](https://cloud.google.com/run). It includes a `Dockerfile` in the `/agent` directory for containerization.

## Learn More

To learn more about the technologies used in this project, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Vercel Deployment](https://nextjs.org/docs/app/building-your-application/deploying)
- [Cloud Run Deployment](https://cloud.google.com/run/docs/deploying)
