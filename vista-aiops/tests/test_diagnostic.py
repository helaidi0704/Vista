from agents.diagnostic_agent import DiagnosticAgent


def test_diagnostic():

    agent = DiagnosticAgent()

    result = agent.analyze(
        "ModuleNotFoundError: No module named requests"
    )

    assert result
