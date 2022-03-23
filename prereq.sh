#!/usr/bin/bash

sudo yum -y update
#---------------------install wget, git, curl----------------
sudo yum -y install wget git curl

# --------------------------install docker & docker compose-------------------------
sudo yum install docker -y -qq
sudo usermod -a -G docker ec2-user
curl -L https://github.com/docker/compose/releases/download/1.9.0/docker-compose-`uname -s`-`uname -m` | sudo tee /usr/local/bin/docker-compose > /dev/null
sudo chmod +x /usr/local/bin/docker-compose
sudo service docker start
sudo chkconfig docker on

# -------------------------install Python (if not python 2.7 by default)-----------
sudo yum -y install gcc

# ---------------------install and setup go 1.9 (PATH & stuff)---------------------
sudo wget https://storage.googleapis.com/golang/go1.9.2.linux-amd64.tar.gz
sudo tar -zxvf  go1.9.2.linux-amd64.tar.gz -C /usr/local/
export PATH=$PATH:/usr/local/go/bin
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bash_profile
mkdir $HOME/work
export GOPATH=$HOME/work
echo 'export GOPATH=$HOME/work' >> ~/.bash_profile

# ------------------------install binaries and samples------------------------
curl -sSL http://bit.ly/2ysbOFE | sudo bash -s 1.1.0 1.1.0 0.4.6
curl -sSL http://bit.ly/2ysbOFE | sudo bash -s 1.2.1 1.2.1 0.4.10

# -------------------------install github fabric libraries---------------------------
go get -u github.com/hyperledger/fabric/core/chaincode/shim
cd ~/work/src/github.com/hyperledger/fabric/
git checkout v1.1.0

# -----------------------install nodejs & npm-------------------
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.6/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 8.9.4
npm install npm@5.6.0 -g

# -----------------------setup mysql database----------------------------
wget http://dev.mysql.com/get/mysql57-community-release-el7-8.noarch.rpm
sudo yum -y localinstall mysql57-community-release-el7-8.noarch.rpm
sudo yum -y install mysql-community-server
sudo service mysqld start

echo "ALTER USER 'root'@'localhost' IDENTIFIED BY 'adnan';" | mysql --user=root --password="$(sudo grep 'temporary password' /var/log/mysqld.log | awk '{print substr($0, 92);}')" ""  --connect-expired-password
echo "CREATE DATABASE bpmn;" | mysql --user=root --password="adnan"

