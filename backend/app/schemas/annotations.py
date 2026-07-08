from typing import Annotated, Literal

from pydantic import Field

from app.schemas.common import CamelModel


class NormPoint(CamelModel):
    nx: float
    ny: float


class BBoxData(CamelModel):
    nx: float
    ny: float
    nw: float = Field(gt=0)
    nh: float = Field(gt=0)


class PolygonData(CamelModel):
    points: list[NormPoint] = Field(min_length=3)
    closed: Literal[True]


class FreehandData(CamelModel):
    points: list[NormPoint] = Field(min_length=2)
    closed: Literal[False]


class BBoxGeometry(CamelModel):
    type: Literal["bbox"]
    bbox: BBoxData


class PolygonGeometry(CamelModel):
    type: Literal["polygon"]
    polygon: PolygonData


class FreehandGeometry(CamelModel):
    type: Literal["freehand"]
    freehand: FreehandData


GeometryDto = Annotated[
    BBoxGeometry | PolygonGeometry | FreehandGeometry, Field(discriminator="type")
]

Severity = Literal["Critique", "Majeur", "Mineur"]


class SaveImageDto(CamelModel):
    """The `image` sub-object of the save-annotations request body.

    Mirrors the frontend's `SaveImageDto` (a subset of `ImageModel`).
    """

    id: str
    name: str
    format: str
    size: int | None = None
    width: int
    height: int
    created_at: str
    src: str | None = None


class SaveCreateAnnotationDto(CamelModel):
    work_id: str
    image_id: str
    defect_label: str
    severity: Severity
    description: str
    shape_label: str
    geometry: GeometryDto


class SaveUpdateAnnotationDto(SaveCreateAnnotationDto):
    id: str


class SaveAnnotationsRequest(CamelModel):
    request_id: str
    sent_at: str
    image: SaveImageDto
    creates: list[SaveCreateAnnotationDto] = Field(default_factory=list)
    updates: list[SaveUpdateAnnotationDto] = Field(default_factory=list)


class CreatedAnnotationRef(CamelModel):
    """Maps a frontend-generated `workId` to the real backend-assigned id.

    Required because the frontend has no other way to learn the persisted
    annotation id for newly created annotations (see plan Decisions).
    """

    work_id: str
    id: str


class SaveAnnotationsResponse(CamelModel):
    success: bool
    request_id: str
    created_work_ids: list[str]
    updated_work_ids: list[str]
    failed_work_ids: list[str]
    backend_message: str
    received_at: str
    created: list[CreatedAnnotationRef]


class DeleteAnnotationResponse(CamelModel):
    success: bool
    id: str
    received_at: str


class AnnotationListItem(CamelModel):
    """Returned by GET /api/images/{id}/annotations — full annotation with defect label."""

    id: str
    image_id: str
    defect_label: str
    severity: Severity
    description: str
    geometry_type: str
    geometry: GeometryDto
    created_at: str
    updated_at: str


class ListAnnotationsResponse(CamelModel):
    success: bool
    annotations: list[AnnotationListItem]
