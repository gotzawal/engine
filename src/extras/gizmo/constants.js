/**
 * The gizmo space defines the coordinate system in which the gizmo operates. This can be one of the
 * following:
 *
 * - 'local': The local coordinate space
 * - 'world': The world coordinate space
 *
 * @typedef {'local' | 'world'} GizmoSpace
 */

/**
 * The gizmo axis defines the direction in which the gizmo operates. This can be one of the
 * following:
 *
 * - 'x': The X axis
 * - 'y': The Y axis
 * - 'z': The Z axis
 * - 'yz': The YZ plane
 * - 'xz': The XZ plane
 * - 'xy': The XY plane
 * - 'xyz': The XYZ space
 * - 'f': The axis facing the camera
 *
 * @typedef {'x' | 'y' | 'z' | 'yz' | 'xz' | 'xy' | 'xyz' | 'f'} GizmoAxis
 */

/**
 * The gizmo drag mode defines how the gizmo is rendered while being dragged. This can be one of the
 * following:
 *
 * - 'show': always show the shapes
 * - 'hide': hide the shapes when dragging
 * - 'selected': show only the axis shapes for the affected axes
 *
 * @typedef {'show' | 'hide' | 'selected'} GizmoDragMode
 */
