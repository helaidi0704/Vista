import docker


class DockerClient:

    def __init__(self):

        self.client = docker.from_env()

    def containers(self):

        return self.client.containers.list()
