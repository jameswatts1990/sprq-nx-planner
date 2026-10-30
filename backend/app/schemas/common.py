from typing import Generic, Literal, TypeVar

from pydantic import BaseModel

T = TypeVar("T")

# A physical cell's chemistry type - see engine.constants.CELL_TYPES.
CellType = Literal["sprq_nx", "sprq"]


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
