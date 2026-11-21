import os

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError

from api.models import Account


class Command(BaseCommand):
    help = "Create or update the deployment Django and portal administrator."

    def handle(self, *args, **options):
        email = os.getenv("ADMIN_EMAIL", "admin@orzo.et").strip().lower()
        password = os.getenv("ADMIN_PASSWORD", "").strip()

        if not email:
            raise CommandError("ADMIN_EMAIL must not be empty.")
        if not password:
            raise CommandError("ADMIN_PASSWORD is required.")

        user_model = get_user_model()
        user, _ = user_model.objects.update_or_create(
            username=email,
            defaults={
                "email": email,
                "is_staff": True,
                "is_superuser": True,
                "is_active": True,
            },
        )
        user.set_password(password)
        user.save()

        account = Account.objects.filter(email=email).first()
        account_values = {
            "full_name": "ORZO Platform Administrator",
            "role": "platform_admin",
            "client_account_type": "",
            "phone": "",
            "organization_name": "ORZO",
            "status": "active",
            "password_hash": make_password(password),
            "must_change_password": False,
        }
        if account is None:
            Account.objects.create(
                id="usr-platform-admin-deploy",
                email=email,
                **account_values,
            )
        else:
            for field, value in account_values.items():
                setattr(account, field, value)
            account.save()

        self.stdout.write(self.style.SUCCESS("Deployment administrator is ready."))
