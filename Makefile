.PHONY: deploy rollback backup logs ps shell superuser migrations-local test-local
deploy:
	./deploy/deploy.sh
rollback:
	./deploy/rollback.sh
backup:
	./deploy/backup.sh
logs:
	docker compose logs -f --tail=100 web
ps:
	docker compose ps
shell:
	docker compose exec web python manage.py shell
superuser:
	docker compose exec web python manage.py createsuperuser
migrations-local:
	docker run --rm -v "$(PWD)":/app -w /app -e DEBUG=1 python:3.12-slim sh -c "pip install -q -r requirements.txt && python manage.py makemigrations core"
test-local:
	docker run --rm -v "$(PWD)":/app -w /app -e DEBUG=1 python:3.12-slim sh -c "pip install -q -r requirements.txt && python manage.py test"
