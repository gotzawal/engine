/**
 * @param {import('../../app/components/Example.mjs').ControlOptions} options - The options.
 * @returns {JSX.Element} The returned JSX Element.
 */
export const controls = ({ observer, ReactPCUI, React, jsx, fragment }) => {
    const { BindingTwoWay, BooleanInput, LabelGroup, Panel } = ReactPCUI;
    return jsx(
        Panel,
        { headerText: 'Rendering' },
        jsx(
            LabelGroup,
            { text: 'DO Pipeline' },
            jsx(BooleanInput, {
                type: 'toggle',
                binding: new BindingTwoWay(),
                link: { observer, path: 'settings.doPipelineEnabled' },
                value: observer.get('settings.doPipelineEnabled')
            })
        )
    );
};
