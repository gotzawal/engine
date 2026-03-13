/**
 * @param {import('../../app/components/Example.mjs').ControlOptions} options - The options.
 * @returns {JSX.Element} The returned JSX Element.
 */
export const controls = ({ observer, ReactPCUI, React, jsx, fragment }) => {
    const { BindingTwoWay, LabelGroup, Panel, SelectInput } = ReactPCUI;
    return fragment(
        jsx(
            Panel,
            { headerText: 'Cluster Lighting' },
            jsx(
                LabelGroup,
                { text: 'Mode' },
                jsx(SelectInput, {
                    binding: new BindingTwoWay(),
                    link: { observer, path: 'settings.clusterMode' },
                    options: [
                        { v: 'gpu', t: 'GPU Compute' },
                        { v: 'cpu', t: 'CPU' }
                    ]
                })
            )
        )
    );
};
