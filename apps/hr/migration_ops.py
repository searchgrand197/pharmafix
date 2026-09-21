"""Custom migration operations shared by HR migrations."""

from django.db.migrations.operations.base import Operation
from django.db.migrations.operations.models import RenameIndex


class RenameIndexIdempotent(Operation):
    """
    Like RenameIndex, but safe when:
    - the old index was already renamed (DB and/or migration state)
    - the new index already exists
    - the old index was never created
    """

    reduces_to_sql = True
    reversible = True

    def __init__(self, model_name, new_name, old_name):
        self.model_name = model_name
        self.new_name = new_name
        self.old_name = old_name

    @property
    def model_name_lower(self):
        return self.model_name.lower()

    def deconstruct(self):
        kwargs = {
            'model_name': self.model_name,
            'new_name': self.new_name,
            'old_name': self.old_name,
        }
        return (f'{self.__class__.__module__}.{self.__class__.__qualname__}', [], kwargs)

    def state_forwards(self, app_label, state):
        model_state = state.models[(app_label, self.model_name_lower)]
        index_names = {index.name for index in model_state.options.get('indexes', [])}
        if self.new_name in index_names or self.old_name not in index_names:
            return
        RenameIndex(
            model_name=self.model_name,
            new_name=self.new_name,
            old_name=self.old_name,
        ).state_forwards(app_label, state)

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        existing = self._existing_index_names(schema_editor)
        if self.new_name in existing or self.old_name not in existing:
            return

        to_model = to_state.apps.get_model(app_label, self.model_name)
        index = self._get_index(to_state, app_label, self.new_name)
        if index is None:
            index = self._get_index(from_state, app_label, self.old_name)
        if index is None:
            return

        index.name = self.new_name
        old_index = index.clone()
        old_index.name = self.old_name
        schema_editor.rename_index(to_model, old_index, index)

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        swapped = RenameIndexIdempotent(
            model_name=self.model_name,
            new_name=self.old_name,
            old_name=self.new_name,
        )
        swapped.database_forwards(app_label, schema_editor, from_state, to_state)

    def describe(self):
        return f'Rename index {self.old_name} to {self.new_name} if needed'

    def _get_index(self, project_state, app_label, name):
        model_state = project_state.models.get((app_label, self.model_name_lower))
        if model_state is None:
            return None
        for index in model_state.options.get('indexes', []):
            if index.name == name:
                return index.clone()
        return None

    @staticmethod
    def _existing_index_names(schema_editor):
        connection = schema_editor.connection
        with connection.cursor() as cursor:
            if connection.vendor == 'sqlite':
                cursor.execute(
                    "SELECT name FROM sqlite_master WHERE type='index' AND name IS NOT NULL"
                )
                return {row[0] for row in cursor.fetchall()}
            if connection.vendor == 'postgresql':
                cursor.execute(
                    """
                    SELECT indexname
                    FROM pg_indexes
                    WHERE schemaname = ANY (current_schemas(false))
                    """
                )
                return {row[0] for row in cursor.fetchall()}
        return set()
