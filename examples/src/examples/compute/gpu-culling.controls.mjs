/**
 * @param {import('../../app/components/Example.mjs').ControlOptions} options - The options.
 * @returns {JSX.Element} The returned JSX Element.
 */
export const controls = ({ observer, ReactPCUI, React, jsx, fragment }) => {
    const { BindingTwoWay, BooleanInput, LabelGroup, Panel, SliderInput } = ReactPCUI;
    return fragment(
        jsx(
            Panel,
            { headerText: 'GPU Rendering Pipeline' },
            jsx(
                LabelGroup,
                { text: 'GPU Frustum Culling' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'data.gpuCulling' }
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Indirect Draw' },
                jsx(BooleanInput, {
                    type: 'toggle',
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'data.indirectDraw' }
                })
            ),
            jsx(
                LabelGroup,
                { text: 'Object Count' },
                jsx(SliderInput, {
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'data.objectCount' },
                    min: 10,
                    max: 500,
                    precision: 0
                })
            )
        )
    );
};
