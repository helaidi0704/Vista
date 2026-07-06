from agents.test_agent import TestAgent


class ValidationAgent:

    def __init__(self):
        self.test_agent = TestAgent()

    def validate(self):

        build = self.test_agent.build_docker()

        return {
            "build_return_code": build.returncode,
            "build_output": build.stdout,
            "build_error": build.stderr
        }
