from django.contrib import admin

from apps.expenses.models import (
    ExpenseLineItem,
    ExpenseParty,
    ExpenseQuickCategory,
    ExpenseQuickService,
    ExpenseTransaction,
)

admin.site.register(ExpenseTransaction)
admin.site.register(ExpenseLineItem)
admin.site.register(ExpenseQuickService)
admin.site.register(ExpenseQuickCategory)
admin.site.register(ExpenseParty)
