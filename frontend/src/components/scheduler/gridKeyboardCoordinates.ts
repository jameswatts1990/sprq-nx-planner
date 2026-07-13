import {
  closestCorners,
  getFirstCollision,
  KeyboardCode,
  type DroppableContainer,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";

const DIRECTIONS: string[] = [KeyboardCode.Down, KeyboardCode.Right, KeyboardCode.Up, KeyboardCode.Left];

/**
 * Custom KeyboardSensor coordinate getter for 2D grid traversal - arrow keys move the
 * active draggable to the nearest droppable slot in that direction, rather than the
 * default single-axis list behaviour. This is dnd-kit's documented "2D grid" pattern
 * (filter droppables lying in the arrow direction, then pick the closest by corners).
 */
export const gridCoordinateGetter: KeyboardCoordinateGetter = (
  event,
  { context: { active, droppableRects, droppableContainers, collisionRect } },
) => {
  if (!DIRECTIONS.includes(event.code)) return undefined;
  event.preventDefault();

  if (!active || !collisionRect) return undefined;

  const filtered: DroppableContainer[] = [];
  droppableContainers.getEnabled().forEach((entry) => {
    if (!entry || entry.disabled) return;
    const rect = droppableRects.get(entry.id);
    if (!rect) return;

    switch (event.code) {
      case KeyboardCode.Down:
        if (collisionRect.top < rect.top) filtered.push(entry);
        break;
      case KeyboardCode.Up:
        if (collisionRect.top > rect.top) filtered.push(entry);
        break;
      case KeyboardCode.Left:
        if (collisionRect.left > rect.left) filtered.push(entry);
        break;
      case KeyboardCode.Right:
        if (collisionRect.left < rect.left) filtered.push(entry);
        break;
    }
  });

  const collisions = closestCorners({
    active,
    collisionRect,
    droppableRects,
    droppableContainers: filtered,
    pointerCoordinates: null,
  });
  const closestId = getFirstCollision(collisions, "id");

  if (closestId != null) {
    const newDroppable = droppableContainers.get(closestId);
    const newRect = newDroppable?.rect.current;
    const newNode = newDroppable?.node.current;
    if (newNode && newRect) {
      return { x: newRect.left, y: newRect.top };
    }
  }

  return undefined;
};
