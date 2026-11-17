from rest_framework import serializers
from .models import Business, Program, PurchaseEntry, Reward, Task


class BusinessSerializer(serializers.ModelSerializer):
    class Meta:
        model = Business
        fields = ["name", "category", "tagline", "address", "lat", "lng", "hours", "language",
                  "pay_upi_id", "shop_code", "approval_mode", "cooldown_minutes", "daily_cap",
                  "require_bill_photo", "max_distance_m"]
        read_only_fields = ["shop_code"]


class RewardSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reward
        fields = ["id", "title", "type", "value", "expiry_days", "terms"]


class TaskSerializer(serializers.ModelSerializer):
    rewards = RewardSerializer(many=True, read_only=True)

    class Meta:
        model = Task
        fields = ["id", "title", "type", "target", "item_name", "repeatable", "max_per_customer", "rewards"]


class ProgramSerializer(serializers.ModelSerializer):
    tasks = TaskSerializer(many=True, read_only=True)

    class Meta:
        model = Program
        fields = ["id", "title", "active", "start", "end", "tasks"]


class EntrySerializer(serializers.ModelSerializer):
    customer = serializers.CharField(source="profile.user.first_name", read_only=True)
    task_title = serializers.CharField(source="task.title", read_only=True)

    shop_code = serializers.CharField(source="profile.business.shop_code", read_only=True)
    bill_url = serializers.SerializerMethodField()

    def get_bill_url(self, o):
        return o.bill_photo.url if o.bill_photo else ""

    class Meta:
        model = PurchaseEntry
        fields = ["id", "profile", "shop_code", "customer", "task", "task_title", "value", "status", "created_at",
                  "far", "distance_m", "bill_url"]
