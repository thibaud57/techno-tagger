"""`scenario.ts`, maintenu a la main, porte les memes champs et valeurs que le modele Python."""

from demo_scenario import DemoPaths, Outcome, Phase, Scenario, StatefulReply, StatelessReply
from protocol_mirror import SCENARIO_TS, ts_interfaces, ts_unions


def test_mirrors_the_scenario_fields_and_literal_values_of_the_python_model() -> None:
    interfaces = ts_interfaces(SCENARIO_TS)
    unions = ts_unions(SCENARIO_TS)

    assert interfaces["Scenario"] == frozenset(Scenario.model_fields)
    assert interfaces["StatelessReply"] == frozenset(StatelessReply.model_fields)
    assert interfaces["StatefulReply"] == frozenset(StatefulReply.model_fields)
    assert interfaces["DemoPaths"] == frozenset(DemoPaths.model_fields)
    assert unions["Outcome"] == {o.value for o in Outcome}
    assert unions["Phase"] == {p.value for p in Phase}
