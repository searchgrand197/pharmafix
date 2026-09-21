from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("expenses", "0002_expenseparty"),
    ]

    operations = [
        migrations.AddField(
            model_name="expensetransaction",
            name="source",
            field=models.CharField(
                choices=[("collection", "Collection"), ("other_funds", "Other Funds")],
                db_index=True,
                default="collection",
                max_length=20,
            ),
        ),
    ]
