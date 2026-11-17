FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN DEBUG=1 SECRET_KEY=build python manage.py collectstatic --noinput && chmod +x deploy/*.sh
CMD ["deploy/entrypoint.sh"]
