class FakeTable:
    """Keeps entities in memory and returns them in row-key order, like Azure Tables within a partition."""

    def __init__(self):
        self.entities = []

    def create_entity(self, entity):
        self.entities.append(entity)

    def query_entities(self, query_filter, **kwargs):
        return iter(sorted(self.entities, key=lambda entity: entity["RowKey"]))
