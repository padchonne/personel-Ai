FROM python:3.12-slim

ENV HOST=0.0.0.0 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/main.py backend/__init__.py ./backend/
COPY app.js index.html styles.css ./

CMD ["python", "-m", "backend.main"]
