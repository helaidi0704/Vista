from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base model serializing/parsing camelCase JSON, matching the Angular
    frontend's DTOs (`frontend/src/app/pages/annotation/annotation.ts`), while
    keeping idiomatic snake_case Python attribute names.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ErrorResponse(CamelModel):
    """Standard error envelope shared by the images and annotations endpoints."""

    success: bool = False
    error_code: str
    backend_message: str
    request_id: str
